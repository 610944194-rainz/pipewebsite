param(
  [ValidateSet("Validate", "Backup", "Update", "Enable", "Disable", "Restore")]
  [string]$Mode = "Validate",
  [string]$BackupPath = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-run\data\review\scheduled-task-backups\YandouBuy-Smokingpipes-Daily-Update.xml"
)

$ErrorActionPreference = "Stop"
$TaskName = "YandouBuy Smokingpipes Daily Update"
$AutomationWorktree = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-run"
$PowerShellExecutable = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$BuildExecutable = "C:\Program Files\nodejs\npm.cmd"
$Launcher = Join-Path $AutomationWorktree "scripts\inventory\run-smokingpipes-scheduled-task-v1.ps1"
# The auto-publish launcher delegates normal inventory work to run-smokingpipes-progressive-daily.ps1.

function Assert-ScheduledTaskPaths {
  foreach ($required in @(
    [pscustomobject]@{ Name = "PowerShell"; Path = $PowerShellExecutable },
    [pscustomobject]@{ Name = "Build executable"; Path = $BuildExecutable },
    [pscustomobject]@{ Name = "Scheduled launcher"; Path = $Launcher }
  )) {
    if (-not [IO.Path]::IsPathRooted($required.Path) -or -not (Test-Path -LiteralPath $required.Path -PathType Leaf)) {
      throw "$($required.Name) must be an existing absolute leaf path: $($required.Path)"
    }
  }
}

switch ($Mode) {
  "Validate" {
    Assert-ScheduledTaskPaths
    [pscustomobject]@{
      taskName = $TaskName
      stateAfterUpdate = "Disabled"
      powershell = $PowerShellExecutable
      launcher = $Launcher
      automationWorktree = $AutomationWorktree
      buildExecutable = $BuildExecutable
      schedule = "daily 10:30,12:30,14:30,16:30,18:30,20:30,22:30"
      multipleInstances = "IgnoreNew"
      restartCount = 2
      restartIntervalMinutes = 15
    }
  }
  "Backup" {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    New-Item -ItemType Directory -Force -Path (Split-Path $BackupPath) | Out-Null
    Export-ScheduledTask -TaskName $TaskName | Set-Content -LiteralPath $BackupPath -Encoding Unicode
    Write-Output "Scheduled task backup written: $BackupPath"
  }
  "Update" {
    Assert-ScheduledTaskPaths
    $argument = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Launcher`""
    $action = New-ScheduledTaskAction -Execute $PowerShellExecutable -Argument $argument -WorkingDirectory $AutomationWorktree
    try {
      $triggers = New-ScheduledTaskTrigger `
        -Daily `
        -At "10:30" `
        -RepetitionInterval (New-TimeSpan -Hours 2) `
        -RepetitionDuration (New-TimeSpan -Hours 12)
    } catch {
      $triggers = @(
        New-ScheduledTaskTrigger -Daily -At "10:30"
        New-ScheduledTaskTrigger -Daily -At "12:30"
        New-ScheduledTaskTrigger -Daily -At "14:30"
        New-ScheduledTaskTrigger -Daily -At "16:30"
        New-ScheduledTaskTrigger -Daily -At "18:30"
        New-ScheduledTaskTrigger -Daily -At "20:30"
        New-ScheduledTaskTrigger -Daily -At "22:30"
      )
    }
    $settings = New-ScheduledTaskSettingsSet `
      -StartWhenAvailable `
      -WakeToRun `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -MultipleInstances IgnoreNew `
      -RestartCount 2 `
      -RestartInterval (New-TimeSpan -Minutes 15)
    $settings.WakeToRun = $true
    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $triggers `
      -Settings $settings `
      -Description "Unattended Smokingpipes daily automation with finite retries and post-apply safety gates." `
      -Force | Out-Null
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
  "Restore" {
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw "Scheduled task backup is missing: $BackupPath" }
    $xml = Get-Content -LiteralPath $BackupPath -Raw -Encoding Unicode
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
    Write-Output "Scheduled task restored from: $BackupPath"
  }
}
