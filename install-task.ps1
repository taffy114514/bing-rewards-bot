# Registers / removes the daily Windows scheduled task for Bing Rewards.
# Written in pure ASCII on purpose: Windows PowerShell 5.1 decodes BOM-less
# script files with the system ANSI code page, so non-ASCII text here breaks parsing.
#
# Usage (any PowerShell, normal user rights):
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -Time "09:30"
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -Time "09:30" -Headless
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -Remove

param(
  [string]$Time = "09:30",
  [string]$TaskName = "BingRewardsAuto",
  [switch]$Headless,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat  = Join-Path $root "run.bat"

if ($Remove) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task: $TaskName" -ForegroundColor Yellow
  } else {
    Write-Host "Scheduled task not found: $TaskName" -ForegroundColor Yellow
  }
  return
}

if (-not (Test-Path $bat)) { throw "run.bat not found: $bat" }
if (-not (Test-Path (Join-Path $root "node_modules\playwright"))) {
  Write-Host "WARN: dependencies not installed yet - run 'npm install' in this folder first." -ForegroundColor Yellow
}

$extra = ""
$modeText = "headed (window moved off-screen)"
if ($Headless) {
  $extra = " --headless"
  $modeText = "headless"
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"$extra" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Daily Bing Rewards auto task" -Force | Out-Null

Write-Host ""
Write-Host "Scheduled task registered: $TaskName" -ForegroundColor Green
Write-Host "  Runs daily at $Time  [$modeText]"
Write-Host "  Run as:  $userId (only while logged on)"
Write-Host "  Command: $bat$extra"
Write-Host "  Log:     $root\logs\cron.log"
Write-Host ""
Write-Host "Trigger it now:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Remove it:       powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -Remove"
Write-Host ""
Write-Host "Note: the task runs as the current user and only when that user is logged on," -ForegroundColor DarkGray
Write-Host "      because it needs the browser desktop session. Login state lives in .\profile." -ForegroundColor DarkGray
