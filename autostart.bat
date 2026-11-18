@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "logs" mkdir "logs"

rem Wait a bit so boot/login activity settles before the browser starts.
if "%~1"=="--now" goto run
timeout /t 180 /nobreak >nul

:run
echo [%date% %time%] autostart triggered >> "logs\cron.log"
node src\cli.js run %2 %3 %4 %5 >> "logs\cron.log" 2>&1
echo [%date% %time%] autostart finished >> "logs\cron.log"
