# Installs a per-user autostart shortcut (no admin rights needed).
#
# Why this exists: registering a Windows Scheduled Task needs an elevated token,
# and creating the login-time shortcut does not. Combined with the built-in
# "already ran successfully today -> skip" guard, this gives one automatic run
# per day, right after the user logs on.
#
#   powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
#   powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1 -Remove

param(
  [switch]$Remove,
  [string]$LinkName = "BingRewardsAuto.lnk"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup $LinkName

if ($Remove) {
  if (Test-Path $lnkPath) {
    Remove-Item $lnkPath -Force
    Write-Host "Removed autostart shortcut: $lnkPath" -ForegroundColor Yellow
  } else {
    Write-Host "Autostart shortcut not found: $lnkPath" -ForegroundColor Yellow
  }
  return
}

$target = Join-Path $root "autostart.bat"
if (-not (Test-Path $target)) { throw "autostart.bat not found: $target" }

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $target
$lnk.WorkingDirectory = $root
$lnk.WindowStyle = 7          # minimized
$lnk.Description = "Daily Bing Rewards auto task"
$lnk.Save()

if (-not (Test-Path $lnkPath)) { throw "failed to create shortcut: $lnkPath" }

Write-Host ""
Write-Host "Autostart installed." -ForegroundColor Green
Write-Host "  Shortcut: $lnkPath"
Write-Host "  Target:   $target (waits 180s, then runs once per day)"
Write-Host "  Log:      $root\logs\cron.log"
Write-Host ""
Write-Host "Test it now (no 3-minute wait):" -ForegroundColor DarkGray
Write-Host "  `"$target`" --now"
Write-Host "Remove it:" -ForegroundColor DarkGray
Write-Host "  powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1 -Remove"
