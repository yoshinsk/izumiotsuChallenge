@echo off
rem start_dev.bat
rem 機能要約: 開発環境でReact/Electron版アプリを起動する。
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
npm run dev

