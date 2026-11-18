[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]

$targetPid = [int]$args[0]
$maxNodes = if ($args.Count -gt 1) { [int]$args[1] } else { 200 }

$root = $AE::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $targetPid)
$winCond = New-Object System.Windows.Automation.AndCondition($cond,
  (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond)
Write-Host ("matched windows: " + $wins.Count)
if ($wins.Count -eq 0) { exit 1 }

$win = $wins[0]
Write-Host ("window: " + $win.Current.Name)

# 找所有 Document（Chromium 的页面内容）
$docCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$docs = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCond)
Write-Host ("documents: " + $docs.Count)
for ($i = 0; $i -lt $docs.Count; $i++) {
  $d = $docs[$i]
  Write-Host ("  [DOC $i] name=" + $d.Current.Name + " rect=" + $d.Current.BoundingRectangle + " pid=" + $d.Current.ProcessId + " class=" + $d.Current.ClassName)
}

if ($docs.Count -eq 0) { exit 2 }

# 在第一个 document 下 dump 元素
$doc = $docs[0]
$allCond = [System.Windows.Automation.Condition]::TrueCondition
$nodes = $doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $allCond)
Write-Host ("descendants under doc: " + $nodes.Count)

$n = 0
foreach ($el in $nodes) {
  if ($n -ge $maxNodes) { break }
  $c = $el.Current
  $rect = $c.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
  $name = $c.Name
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $ct = $c.ControlType.ProgrammaticName -replace "ControlType\.", ""
  Write-Host ("[N] " + $ct + " | " + $name.Substring(0, [Math]::Min(60, $name.Length)) + " | " + [int]$rect.X + "," + [int]$rect.Y + " " + [int]$rect.Width + "x" + [int]$rect.Height)
  $n++
}
Write-Host ("printed: " + $n)
