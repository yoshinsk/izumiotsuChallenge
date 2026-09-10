// electron/main.ts
// 機能要約: Electronのメインプロセス。ウィンドウ作成、メニュー非表示、CSV読込・保存、終了操作のOS連携を担当する。

import { app, BrowserWindow, dialog, ipcMain, Menu, OpenDialogOptions, SaveDialogOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;

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

ipcMain.handle("csv:save", async (_event, payload: { defaultName: string; content: string }) => {
  const options: SaveDialogOptions = {
    title: "ランキングCSVを保存",
    defaultPath: payload.defaultName,
    filters: [
      { name: "CSVファイル", extensions: ["csv"] },
      { name: "すべてのファイル", extensions: ["*"] }
    ]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return null;
  }

  // Excelで文字化けしにくいよう、UTF-8 BOM付きで保存する。
  await fs.writeFile(result.filePath, `\uFEFF${payload.content}`, "utf8");
  return result.filePath;
});

ipcMain.handle("app:quit", () => {
  app.quit();
});
