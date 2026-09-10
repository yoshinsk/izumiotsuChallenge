@echo off
rem build_portable.bat
rem 機能要約: インストーラー不要のWindows portable exeをreleaseフォルダへ作成する。
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
npm install
if errorlevel 1 exit /b 1
npm run dist:win

