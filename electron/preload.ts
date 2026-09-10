// electron/preload.ts
// 機能要約: レンダラーへCSV選択・読込・保存だけを公開する安全な橋渡し。

import { contextBridge, ipcRenderer, webUtils } from "electron";

const api = {
  selectCsvFile: (): Promise<string | null> => ipcRenderer.invoke("csv:select"),
  readCsvFile: (filePath: string): Promise<{ filePath: string; fileName: string; base64: string }> =>
    ipcRenderer.invoke("csv:read", filePath),
  saveCsvFile: (payload: { defaultName: string; content: string }): Promise<string | null> =>
    ipcRenderer.invoke("csv:save", payload),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
};

contextBridge.exposeInMainWorld("rankingApi", api);
