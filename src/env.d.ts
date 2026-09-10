// src/env.d.ts
// 機能要約: ViteとElectron preload APIの型定義。

/// <reference types="vite/client" />

interface Window {
  rankingApi: {
    selectCsvFile: () => Promise<string | null>;
    readCsvFile: (filePath: string) => Promise<{ filePath: string; fileName: string; base64: string }>;
    saveCsvFile: (payload: { defaultName: string; content: string }) => Promise<string | null>;
    getPathForFile: (file: File) => string;
    quitApp: () => Promise<void>;
  };
}
