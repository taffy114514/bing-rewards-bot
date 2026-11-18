[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]

$root = $AE::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
Write-Host ("windows: " + $wins.Count)
foreach ($w in $wins) {
  $c = $w.Current
  Write-Host ("[WIN] pid=" + $c.ProcessId + " class=" + $c.ClassName + " name=" + $c.Name + " rect=" + $c.BoundingRectangle)
}

Write-Host ""
Write-Host "=== processes ==="
Get-Process msedge -ErrorAction SilentlyContinue | Select-Object -First 5 Id, MainWindowTitle | Format-Table -AutoSize | Out-String | Write-Host
