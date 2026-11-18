@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal

set "TARGET=%~dp0bot-autostart.bat"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BingRewardsBot.lnk"

echo Installing auto-start shortcut:
echo   %LNK%
echo   -^> %TARGET%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%');" ^
  "$s.TargetPath='%TARGET%';" ^
  "$s.WorkingDirectory='%~dp0';" ^
  "$s.WindowStyle=7;" ^
  "$s.Description='Bing Rewards auto bot';" ^
  "$s.Save();" ^
  "Write-Host 'shortcut created' -ForegroundColor Green"

if errorlevel 1 (
    echo.
    echo [FAILED] could not create the shortcut.
    pause
    exit /b 1
)

echo.
echo Done. The bot will run about 3 minutes after each Windows logon.
echo Remove it any time by deleting that .lnk file.
echo.
pause
