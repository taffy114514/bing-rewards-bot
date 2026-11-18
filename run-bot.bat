@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   Microsoft Rewards Auto Bot (real mouse input)
echo ================================================
echo.
echo   Launching Edge and completing:
echo     - daily activities
echo     - streaks / earn page tasks
echo     - desktop and mobile searches
echo.
echo   Every click is a genuine OS-level mouse click,
echo   so you can take over at any time.
echo.

src-bot\BingRewardsBot.exe %*

echo.
echo   ---- finished ----
echo   Logs: src-bot\logs\
echo.
pause
