// electron/main.ts
// 機能要約: Electronのメインプロセス。最大化ウィンドウ作成、メニュー非表示、CSV読込、Excel/PDF保存、終了操作のOS連携を担当する。

import { app, BrowserWindow, dialog, ipcMain, Menu, OpenDialogOptions, SaveDialogOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

let mainWindow: BrowserWindow | null = null;

type PdfRankingRow = {
  rank: number;
  carNumber: string;
  carName: string;
  valueText: string;
  detailText: string;
};

type PdfRankingPayload = {
  defaultName: string;
  course: string;
  className: string;
  rows: PdfRankingRow[];
};

function createMainWindow(): void {
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, "icon.ico") : path.join(app.getAppPath(), "build", "icon.ico");

  // 表示領域を広めに取り、3コース分のランキングを横並びで確認しやすくする。
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: "#f4f5f0",
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("csv:select", async () => {
  const options: OpenDialogOptions = {
    title: "走行結果CSVを選択",
    properties: ["openFile"],
    filters: [
      { name: "CSVファイル", extensions: ["csv"] },
      { name: "すべてのファイル", extensions: ["*"] }
    ]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("csv:read", async (_event, filePath: string) => {
  // 文字コード判定はレンダラーのTextDecoderで行うため、メイン側では生バイトをbase64で渡す。
  const bytes = await fs.readFile(filePath);
  return {
    filePath,
    fileName: path.basename(filePath),
    base64: bytes.toString("base64")
  };
});

ipcMain.handle("excel:save", async (_event, payload: { defaultName: string; base64: string }) => {
  const options: SaveDialogOptions = {
    title: "ランキングExcelを保存",
    defaultPath: payload.defaultName,
    filters: [
      { name: "Excelファイル", extensions: ["xlsx"] },
      { name: "すべてのファイル", extensions: ["*"] }
    ]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.writeFile(result.filePath, Buffer.from(payload.base64, "base64"));
  return result.filePath;
});

ipcMain.handle("pdf:save", async (_event, payload: PdfRankingPayload) => {
  const options: SaveDialogOptions = {
    title: "リザルトPDFを保存",
    defaultPath: payload.defaultName,
    filters: [
      { name: "PDFファイル", extensions: ["pdf"] },
      { name: "すべてのファイル", extensions: ["*"] }
    ]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return null;
  }

  const pdf = await renderRankingPdf(payload);
  await fs.writeFile(result.filePath, pdf);
  return result.filePath;
});

ipcMain.handle("app:quit", () => {
  app.quit();
});

async function renderRankingPdf(payload: PdfRankingPayload): Promise<Buffer> {
  const htmlPath = path.join(app.getPath("temp"), `izumiotsu-ranking-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  try {
    // Noto Sans JPはサイズが大きいためdata URLにせず、一時HTMLから同梱ファイルを参照してPDF化する。
    await fs.writeFile(htmlPath, rankingPdfHtml(payload), "utf8");
    await pdfWindow.loadFile(htmlPath);
    await pdfWindow.webContents.executeJavaScript("document.fonts.ready.then(() => true)", true);
    return await pdfWindow.webContents.printToPDF({
      pageSize: "A4",
      landscape: false,
      preferCSSPageSize: true,
      printBackground: true,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      scale: scaleForPdfRows(payload.rows.length)
    });
  } finally {
    pdfWindow.destroy();
    await fs.unlink(htmlPath).catch(() => undefined);
  }
}

function rankingPdfHtml(payload: PdfRankingPayload): string {
  const logoUrl = pathToFileURL(resourcePath("pdf-logo.JPG")).href;
  const fontUrl = pathToFileURL(resourcePath("NotoSansJP-VF.ttf")).href;
  const rows = payload.rows.map((row) => pdfRowHtml(row)).join("");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <style>
    @font-face {
      font-family: "Noto Sans JP";
      src: url("${fontUrl}") format("truetype");
      font-weight: 100 900;
      font-style: normal;
    }
    @page { size: A4 portrait; margin: 11mm 10mm 15mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #101316;
      font-family: "Noto Sans JP", sans-serif;
      background: #ffffff;
    }
    .page {
      position: relative;
      min-height: 267mm;
      padding-bottom: 24mm;
    }
    header {
      text-align: center;
      border-bottom: 2px solid #23272a;
      padding: 0 0 5mm;
      margin-bottom: 5mm;
    }
    .event {
      display: block;
      font-size: 14pt;
      font-weight: 800;
      letter-spacing: 0;
    }
    .class-name {
      display: block;
      margin-top: 1mm;
      font-size: 18pt;
      font-weight: 900;
      letter-spacing: 0;
    }
    .course {
      margin: 0 0 3mm;
      font-size: 11pt;
      font-weight: 700;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: ${tableFontSize(payload.rows.length)}pt;
    }
    th, td {
      border-bottom: 1px solid #d8ddd2;
      padding: ${tableCellPadding(payload.rows.length)}mm 1.3mm;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    th {
      background: #23272a;
      color: #ffffff;
      font-weight: 800;
      text-align: center;
    }
    th:nth-child(1), td:nth-child(1) { width: 10mm; text-align: center; }
    th:nth-child(2), td:nth-child(2) { width: 19mm; text-align: center; }
    th:nth-child(4), td:nth-child(4) { width: 23mm; text-align: right; font-weight: 800; }
    th:nth-child(5), td:nth-child(5) { width: 60mm; }
    .empty {
      text-align: center;
      color: #687064;
    }
    .logo {
      position: fixed;
      right: 10mm;
      bottom: 6mm;
      width: 42mm;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <span class="event">泉大津Challenge</span>
      <span class="class-name">${escapeHtml(payload.className)}</span>
    </header>
    <p class="course">${escapeHtml(payload.course)}</p>
    <table>
      <thead>
        <tr><th>位</th><th>ゼッケン</th><th>車名</th><th>値</th><th>詳細</th></tr>
      </thead>
      <tbody>${rows || '<tr><td class="empty" colspan="5">該当なし</td></tr>'}</tbody>
    </table>
    <img class="logo" src="${logoUrl}" alt="">
  </div>
</body>
</html>`;
}

function pdfRowHtml(row: PdfRankingRow): string {
  return `<tr><td>${row.rank}</td><td>${escapeHtml(row.carNumber)}</td><td>${escapeHtml(row.carName)}</td><td>${escapeHtml(
    row.valueText
  )}</td><td>${escapeHtml(row.detailText)}</td></tr>`;
}

function resourcePath(fileName: string): string {
  // 開発時はbuildフォルダ、配布版ではelectron-builderのextraResources配下から読み込む。
  return app.isPackaged ? path.join(process.resourcesPath, fileName) : path.join(app.getAppPath(), "build", fileName);
}

function scaleForPdfRows(rowCount: number): number {
  if (rowCount > 36) {
    return 0.72;
  }
  if (rowCount > 28) {
    return 0.84;
  }
  return 1;
}

function tableFontSize(rowCount: number): number {
  if (rowCount > 36) {
    return 6.8;
  }
  if (rowCount > 28) {
    return 7.4;
  }
  return 8.6;
}

function tableCellPadding(rowCount: number): number {
  if (rowCount > 36) {
    return 0.55;
  }
  if (rowCount > 28) {
    return 0.7;
  }
  return 0.95;
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    const replacements: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&#39;",
      "\"": "&quot;"
    };
    return replacements[char] ?? char;
  });
}
