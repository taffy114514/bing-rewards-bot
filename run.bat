@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
node src\cli.js run %* >> "logs\cron.log" 2>&1
exit /b %ERRORLEVEL%
