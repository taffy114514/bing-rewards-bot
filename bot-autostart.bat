@echo off
rem Auto-start entry: wait a bit after logon, then run the bot and log to file.
rem Pass --now to skip the delay (for testing).
chcp 65001 >nul
cd /d "%~dp0"

if /i not "%~1"=="--now" (
    timeout /t 180 /nobreak >nul
)

if not exist "src-bot\logs" mkdir "src-bot\logs"
src-bot\BingRewardsBot.exe >> "src-bot\logs\autostart.log" 2>&1
