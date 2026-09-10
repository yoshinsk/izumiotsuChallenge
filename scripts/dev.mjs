// scripts/dev.mjs
// 機能要約: Vite開発サーバーの準備後にElectronを起動する開発用ランチャー。

import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const electronCommand = isWindows ? "node_modules\\.bin\\electron.cmd" : "node_modules/.bin/electron";

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: options.stdio ?? "inherit",
    shell: false,
    env: { ...process.env, ...options.env }
  });
}

const buildElectron = run(npmCommand, ["run", "build:electron"]);

buildElectron.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  const vite = run(npmCommand, ["exec", "vite", "--", "--host", "127.0.0.1"], { stdio: "pipe" });
  let electronStarted = false;

  vite.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!electronStarted && text.includes("Local:")) {
      electronStarted = true;
      run(electronCommand, ["."], {
        env: {
          VITE_DEV_SERVER_URL: "http://127.0.0.1:5173"
        }
      }).on("exit", () => {
        vite.kill();
      });
    }
  });

  vite.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
});

