// src/main.tsx
// 機能要約: ReactアプリをElectronレンダラーへマウントするエントリポイント。

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

