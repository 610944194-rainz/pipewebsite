$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\NING MEI\Desktop\pipewebsite"
$TaskName = "YandouBuy Smokingpipes Daily Update"
$RunScript = Join-Path $ProjectRoot "scripts\inventory\run-smokingpipes-progressive-daily.ps1"

if (-not (Test-Path $RunScript)) {
  throw "Daily runner script not found: $RunScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`"" `
  -WorkingDirectory $ProjectRoot

try {
  $trigger = New-ScheduledTaskTrigger `
    -Daily `
    -At "10:30" `
    -RepetitionInterval (New-TimeSpan -Hours 2) `
    -RepetitionDuration (New-TimeSpan -Hours 12)
  $triggerMode = "single daily trigger with PT2H repetition for PT12H"
} catch {
  Write-Host "Daily repetition trigger is not supported on this system. Falling back to multiple daily triggers."

  $trigger = @(
    New-ScheduledTaskTrigger -Daily -At "10:30"
    New-ScheduledTaskTrigger -Daily -At "12:30"
    New-ScheduledTaskTrigger -Daily -At "14:30"
    New-ScheduledTaskTrigger -Daily -At "16:30"
    New-ScheduledTaskTrigger -Daily -At "18:30"
    New-ScheduledTaskTrigger -Daily -At "20:30"
    New-ScheduledTaskTrigger -Daily -At "22:30"
  )
  $triggerMode = "fallback multiple daily triggers: 10:30, 12:30, 14:30, 16:30, 18:30, 20:30, 22:30"
}

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

$settings.WakeToRun = $true
$settings.MultipleInstances = "IgnoreNew"

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Runs the YandouBuy Smokingpipes progressive daily inventory update every 2 hours during the daily window." `
  -Force | Out-Null

Write-Output "Task installed or updated: $TaskName"
Write-Output "WakeToRun: enabled"
Write-Output "StartWhenAvailable: enabled"
Write-Output "MultipleInstances: IgnoreNew"
Write-Output "AllowStartIfOnBatteries: enabled"
Write-Output "DontStopIfGoingOnBatteries: enabled"
Write-Output "Retry schedule: 10:30 + every 2 hours until 22:30"
Write-Output "Run time limit: system default"
Write-Output "Trigger mode: $triggerMode"
Write-Output "Runner: $RunScript"
