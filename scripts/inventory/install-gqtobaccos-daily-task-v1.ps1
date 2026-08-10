param(
  [ValidateSet("Validate", "Update", "Enable", "Disable")]
  [string]$Mode = "Validate",
  [switch]$ApplyProduction
)

$ErrorActionPreference = "Stop"
$TaskName = "YandouBuy GQ Tobaccos Daily Update"
$AutomationWorktree = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$PowerShellExecutable = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$Launcher = Join-Path $AutomationWorktree "scripts\inventory\run-gqtobaccos-auto-publish.ps1"

function Assert-ScheduledTaskPaths {
  foreach ($item in @(
    [pscustomobject]@{ Name = "PowerShell"; Path = $PowerShellExecutable },
    [pscustomobject]@{ Name = "GQ launcher"; Path = $Launcher }
  )) {
    if (-not [IO.Path]::IsPathRooted($item.Path) -or -not (Test-Path -LiteralPath $item.Path -PathType Leaf)) {
      throw "$($item.Name) must be an existing absolute leaf path: $($item.Path)"
    }
  }
}

switch ($Mode) {
  "Validate" {
    Assert-ScheduledTaskPaths
    [pscustomobject]@{
      taskName = $TaskName
      stateAfterUpdate = "Disabled"
      schedule = "daily 07:30 Asia/Shanghai"
      scheduleBasis = "Observed Danish task at 09:00 and Smokingpipes task from 10:30 every two hours."
      launcher = $Launcher
      productionWrites = $ApplyProduction
      sharedInventoryLock = "data/inventory/state/smokingpipes.lock"
    }
  }
  "Update" {
    Assert-ScheduledTaskPaths
    $modeArgument = if ($ApplyProduction) { " -ApplyProduction" } else { " -NoProductionWrite" }
    $argument = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Launcher`"$modeArgument"
    $action = New-ScheduledTaskAction -Execute $PowerShellExecutable -Argument $argument -WorkingDirectory $AutomationWorktree
    $trigger = New-ScheduledTaskTrigger -Daily -At "07:30"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "GQ Tobaccos daily source adapter; shared inventory lock protects Production." -Force | Out-Null
    Disable-ScheduledTask -TaskName $TaskName | Out-Null
    Write-Output "Scheduled task updated and left Disabled: $TaskName"
  }
  "Enable" {
    Enable-ScheduledTask -TaskName $TaskName | Out-Null
    Write-Output "Scheduled task enabled: $TaskName"
  }
  "Disable" {
    Disable-ScheduledTask -TaskName $TaskName | Out-Null
    Write-Output "Scheduled task disabled: $TaskName"
  }
}
