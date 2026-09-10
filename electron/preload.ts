// electron/preload.ts
// 機能要約: レンダラーへCSV選択・読込・保存・終了だけを公開する安全な橋渡し。

import { contextBridge, ipcRenderer, webUtils } from "electron";

const api = {
  selectCsvFile: (): Promise<string | null> => ipcRenderer.invoke("csv:select"),
  readCsvFile: (filePath: string): Promise<{ filePath: string; fileName: string; base64: string }> =>
    ipcRenderer.invoke("csv:read", filePath),
  saveExcelFile: (payload: { defaultName: string; base64: string }): Promise<string | null> =>
    ipcRenderer.invoke("excel:save", payload),
  savePdfFile: (payload: {
    defaultName: string;
    course: string;
    className: string;
    rows: { rank: number; carNumber: string; carName: string; valueText: string; detailText: string }[];
  }): Promise<string | null> => ipcRenderer.invoke("pdf:save", payload),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  quitApp: (): Promise<void> => ipcRenderer.invoke("app:quit")
};

contextBridge.exposeInMainWorld("rankingApi", api);
