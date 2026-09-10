@echo off
rem run_tests.bat
rem 機能要約: TypeScriptの型検査とランキング集計テストを実行する。
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
npm test

