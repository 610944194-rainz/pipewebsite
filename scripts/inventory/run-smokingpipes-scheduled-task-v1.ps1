param(
  [string]$AutomationWorktree = "",
  [string]$StateRoot = "",
  [string]$ReleaseRoot = "",
  [ValidateRange(1, 200)]
  [int]$ProgressiveDetailMax = 50,
  [ValidateRange(1, 2000)]
  [int]$MaxAutoApply = 2000,
  [ValidateRange(1, 14400)]
  [int]$DailyTimeoutSeconds = 3600,
  [switch]$NoProductionWrite,
  [switch]$NoPush,
  [switch]$PreflightOnly,
  [switch]$NoLiveCollection,
  [string]$CycleId = "",
  [switch]$NotificationDryRun
)

$ErrorActionPreference = "Stop"
$script:IsWindowsPlatform = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
if (-not $AutomationWorktree) {
  $AutomationWorktree = if ($script:IsWindowsPlatform) {
    "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-run"
  } else {
    "/srv/yandoubuy/app"
  }
}
if (-not $StateRoot) {
  $StateRoot = if ($script:IsWindowsPlatform) {
    "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-state"
  } else {
    "/srv/yandoubuy/runtime/smokingpipes/state"
  }
}
if (-not $ReleaseRoot) {
  $ReleaseRoot = if ($script:IsWindowsPlatform) {
    "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-release"
  } else {
    "/srv/yandoubuy/runtime/smokingpipes/release"
  }
}
$script:notificationAttempted = $false
$script:runId = "scheduler-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$script:startedAt = (Get-Date).ToString("o")
$script:logRoot = Join-Path (Join-Path $StateRoot "logs") "scheduler"
New-Item -ItemType Directory -Path $script:logRoot -Force | Out-Null
$script:logPath = Join-Path $script:logRoot ("run-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
$script:jsonPath = [IO.Path]::ChangeExtension($script:logPath, ".json")
$script:latestLogPath = Join-Path $script:logRoot "latest.log"
$script:latestJsonPath = Join-Path $script:logRoot "latest.json"
$script:utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:run = [ordered]@{
  schemaVersion = 1
  runId = $script:runId
  startedAt = $script:startedAt
  completedAt = $null
  status = "running"
  exitCode = $null
  timeoutSeconds = $DailyTimeoutSeconds
  ownedPid = $null
  parameters = [ordered]@{
    automationWorktree = $AutomationWorktree
    stateRoot = $StateRoot
    releaseRoot = $ReleaseRoot
    progressiveDetailMax = $ProgressiveDetailMax
    maxAutoApply = $MaxAutoApply
    dailyTimeoutSeconds = $DailyTimeoutSeconds
    noProductionWrite = [bool]$NoProductionWrite
    noPush = [bool]$NoPush
    preflightOnly = [bool]$PreflightOnly
    noLiveCollection = [bool]$NoLiveCollection
    cycleId = $CycleId
  }
  stages = @()
  notification = $null
  error = $null
}

function Redact-SchedulerText {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  return ($Value -replace '(?i)(pushdeer(?:_push)?key|token|authorization)(=|\s+)[^\s"'']+', '$1$2***')
}

function Save-SchedulerState {
  [IO.File]::WriteAllText($script:jsonPath, ($script:run | ConvertTo-Json -Depth 10), $script:utf8NoBom)
  Copy-Item -LiteralPath $script:jsonPath -Destination $script:latestJsonPath -Force
  if (Test-Path -LiteralPath $script:logPath) {
    Copy-Item -LiteralPath $script:logPath -Destination $script:latestLogPath -Force
  }
}

function Write-SchedulerLog {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date).ToString("o"), (Redact-SchedulerText $Message)
  Add-Content -LiteralPath $script:logPath -Value $line -Encoding utf8
  Write-Output $line
}

function Add-SchedulerStage {
  param([string]$Stage, [string]$Message = "")
  $entry = [ordered]@{ stage = $Stage; at = (Get-Date).ToString("o"); message = (Redact-SchedulerText $Message) }
  $script:run.stages += [pscustomobject]$entry
  Write-SchedulerLog ("[{0}] {1}" -f $Stage, $entry.message)
  Save-SchedulerState
}

function Get-PushDeerConfiguration {
  foreach ($name in @("PUSHDEER_KEY", "PUSHDEER_PUSHKEY", "YAN_DOUBUY_PUSHDEER_PUSHKEY")) {
    $value = [string][Environment]::GetEnvironmentVariable($name, "Process")
    if ($value) { return [pscustomobject]@{ key = $value; envName = $name } }
  }
  return [pscustomobject]@{ key = ""; envName = "" }
}

function Send-SchedulerFailureNotification {
  param([string]$Kind, [string]$Reason)
  if ($script:notificationAttempted) { return $script:run.notification }
  $script:notificationAttempted = $true
  $config = Get-PushDeerConfiguration
  $result = [ordered]@{
    attempted = $true
    configured = [bool]$config.key
    sent = $false
    skipped = $false
    envName = $config.envName
    kind = $Kind
    reason = (Redact-SchedulerText $Reason)
    at = (Get-Date).ToString("o")
  }
  if (-not $config.key) {
    $result.skipped = $true
    $result.reason = "missing PushDeer key"
  } elseif ($NotificationDryRun) {
    $result.skipped = $true
    $result.reason = "dry-run notification"
  } else {
    try {
      $title = [Uri]::EscapeDataString("Smokingpipes V2 scheduler $Kind")
      $body = [Uri]::EscapeDataString((Redact-SchedulerText $Reason).Substring(0, [Math]::Min(1000, (Redact-SchedulerText $Reason).Length)))
      $key = [Uri]::EscapeDataString($config.key)
      $response = Invoke-RestMethod -Method Get -Uri "https://api2.pushdeer.com/message/push?pushkey=$key&text=$title&desp=$body" -TimeoutSec 20
      $result.sent = $true
      $result.reason = "sent"
    } catch {
      $result.reason = Redact-SchedulerText $_.Exception.Message
    }
  }
  $script:run.notification = [pscustomobject]$result
  Save-SchedulerState
  return $script:run.notification
}

function Quote-PowerShellArgument {
  param([string]$Value)
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Get-SmokingpipesPowerShellExecutable {
  if ($script:IsWindowsPlatform) {
    return Join-Path $PSHOME "powershell.exe"
  }
  $pwsh = Get-Command pwsh -CommandType Application -ErrorAction Stop | Select-Object -First 1
  return $pwsh.Source
}

function Get-OwnedProcessTree {
  param([int]$RootPid)
  if ($script:IsWindowsPlatform) {
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  } else {
    $all = @(
      & ps -eo pid=,ppid= |
        ForEach-Object {
          $parts = ($_ -split "\s+" | Where-Object { $_ })
          if ($parts.Count -ge 2) {
            [pscustomobject]@{
              ProcessId = [int]$parts[0]
              ParentProcessId = [int]$parts[1]
            }
          }
        }
    )
  }
  $children = @{}
  foreach ($process in $all) {
    $parent = [int]$process.ParentProcessId
    if (-not $children.ContainsKey($parent)) { $children[$parent] = @() }
    $children[$parent] += [int]$process.ProcessId
  }
  $ordered = New-Object System.Collections.Generic.List[int]
  $stack = New-Object System.Collections.Generic.Stack[int]
  $stack.Push($RootPid)
  while ($stack.Count -gt 0) {
    $pidValue = $stack.Pop()
    if ($ordered.Contains($pidValue)) { continue }
    $ordered.Add($pidValue)
    if ($children.ContainsKey($pidValue)) {
      foreach ($child in $children[$pidValue]) { $stack.Push([int]$child) }
    }
  }
  return @($ordered)
}

function Stop-OwnedProcessTree {
  param([int]$RootPid)
  $pids = @(Get-OwnedProcessTree -RootPid $RootPid)
  [array]::Reverse($pids)
  foreach ($pidValue in $pids) {
    try { Stop-Process -Id $pidValue -Force -ErrorAction Stop } catch { }
  }
  return $pids
}

function Get-NodeResultSummary {
  param([string]$Output)
  $markers = @($Output -split "`r?`n" | Where-Object { $_.StartsWith("SMOKINGPIPES_V2_RESULT_JSON=") })
  if ($markers.Count -ne 1) {
    return [pscustomobject]@{ valid = $false; reason = "expected exactly one SMOKINGPIPES_V2_RESULT_JSON marker; found $($markers.Count)"; result = $null }
  }
  try {
    $result = ($markers[0].Substring("SMOKINGPIPES_V2_RESULT_JSON=".Length) | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    return [pscustomobject]@{ valid = $false; reason = "result marker JSON is invalid: $($_.Exception.Message)"; result = $null }
  }
  $successfulStatuses = @("published", "no-change", "same-day-complete", "enriching-details", "ready-to-bundle", "bundle-ready", "preflight-passed", "already-running")
  $status = [string]$result.status
  if ($successfulStatuses -notcontains $status) {
    return [pscustomobject]@{ valid = $false; reason = "result status is not successful: $status"; result = $result }
  }
  return [pscustomobject]@{ valid = $true; reason = ""; result = $result }
}

Add-SchedulerStage -Stage "scheduled-entry" -Message "scheduler entry started"
$exitCode = 1
try {
  Add-SchedulerStage -Stage "runtime-check" -Message "validating runtime and wrapper"
  $runtimeRoot = (Resolve-Path -LiteralPath $AutomationWorktree).Path
  $wrapper = Join-Path (Join-Path (Join-Path $runtimeRoot "scripts") "inventory") "run-smokingpipes-auto-publish.ps1"
  if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw "Smokingpipes V2 scheduled wrapper is missing: $wrapper" }
  if ([IO.Path]::GetFullPath($StateRoot).StartsWith([IO.Path]::GetFullPath($runtimeRoot), [StringComparison]::OrdinalIgnoreCase)) { throw "StateRoot must be outside the runtime Git worktree" }

  $stdoutPath = Join-Path $script:logRoot ($script:runId + ".stdout.log")
  $stderrPath = Join-Path $script:logRoot ($script:runId + ".stderr.log")
  $childArgs = @(
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", (Quote-PowerShellArgument $wrapper),
    "-StateRoot", (Quote-PowerShellArgument $StateRoot),
    "-ReleaseRoot", (Quote-PowerShellArgument $ReleaseRoot),
    "-ProgressiveDetailMax", $ProgressiveDetailMax,
    "-MaxAutoApply", $MaxAutoApply,
    "-DailyTimeoutSeconds", $DailyTimeoutSeconds
  )
  if ($CycleId) { $childArgs += @("-CycleId", (Quote-PowerShellArgument $CycleId)) }
  if ($NoProductionWrite) { $childArgs += "-NoProductionWrite" }
  if ($NoPush) { $childArgs += "-NoPush" }
  if ($PreflightOnly) { $childArgs += "-PreflightOnly" }
  if ($NoLiveCollection) { $childArgs += "-NoLiveCollection" }

  Add-SchedulerStage -Stage "git-fetch" -Message "delegated to V2 wrapper in owned child"
  Add-SchedulerStage -Stage "git-fast-forward" -Message "delegated to V2 wrapper in owned child"
  Add-SchedulerStage -Stage "node-start" -Message "starting owned V2 wrapper process"
  $startProcess = @{
    FilePath = (Get-SmokingpipesPowerShellExecutable)
    ArgumentList = ($childArgs -join " ")
    WorkingDirectory = $runtimeRoot
    RedirectStandardOutput = $stdoutPath
    RedirectStandardError = $stderrPath
    PassThru = $true
  }
  if ($script:IsWindowsPlatform) { $startProcess.WindowStyle = "Hidden" }
  $child = Start-Process @startProcess
  $script:run.ownedPid = $child.Id
  Save-SchedulerState
  if ($script:IsWindowsPlatform) {
    $exited = $child.WaitForExit($DailyTimeoutSeconds * 1000)
  } else {
    $deadline = [DateTime]::UtcNow.AddSeconds($DailyTimeoutSeconds)
    $exited = $false
    while ([DateTime]::UtcNow -lt $deadline) {
      $child.Refresh()
      if ($child.HasExited) {
        $exited = $true
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if (-not $exited) {
      $child.Refresh()
      $exited = $child.HasExited
    }
  }
  if (-not $exited) {
    $ownedTree = Stop-OwnedProcessTree -RootPid $child.Id
    $script:run.ownedProcessTree = $ownedTree
    $script:run.status = "timeout"
    $script:run.exitCode = 124
    Add-SchedulerStage -Stage "timeout" -Message ("owned process timed out after {0}s; terminated PIDs: {1}" -f $DailyTimeoutSeconds, ($ownedTree -join ","))
    Send-SchedulerFailureNotification -Kind "timeout" -Reason ("owned V2 process exceeded DailyTimeoutSeconds=$DailyTimeoutSeconds") | Out-Null
    $exitCode = 124
  } else {
    $child.Refresh()
    $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
    $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
    foreach ($line in @($stdout, $stderr) | Where-Object { $_ }) { Write-SchedulerLog $_ }
    $combinedOutput = $stdout + "`n" + $stderr
    if ($combinedOutput -match 'SCHEDULER_STAGE collection') { Add-SchedulerStage -Stage "collection" -Message "V2 collection started" }
    if ($combinedOutput -match 'SCHEDULER_STAGE release') { Add-SchedulerStage -Stage "release" -Message "V2 release phase reached" }
    $exitCode = [int]$child.ExitCode
    $nodeSummary = Get-NodeResultSummary -Output $combinedOutput
    if ($nodeSummary.result) { $script:run.nodeResult = $nodeSummary.result }
    $nodeNotificationSent = [bool]($nodeSummary.result -and $nodeSummary.result.notification -and $nodeSummary.result.notification.sent)
    if ($exitCode -eq 0 -and $nodeSummary.valid) {
      $script:run.status = "completed"
      $script:run.exitCode = 0
      Add-SchedulerStage -Stage "completed" -Message "owned V2 wrapper completed"
    } else {
      $script:run.status = "failed"
      $script:run.exitCode = if ($exitCode -ne 0) { $exitCode } else { 1 }
      $script:run.error = Redact-SchedulerText ($combinedOutput.Trim())
      $failureReason = if ($exitCode -ne 0) { "owned V2 wrapper exited $exitCode" } else { "V2 result validation failed: $($nodeSummary.reason)" }
      Add-SchedulerStage -Stage "failed" -Message $failureReason
      if (-not $nodeNotificationSent) {
        Send-SchedulerFailureNotification -Kind "v2-failed" -Reason ($failureReason + "; " + $script:run.error) | Out-Null
      }
      $exitCode = $script:run.exitCode
    }
  }
} catch {
  $script:run.status = "failed"
  $script:run.exitCode = 1
  $script:run.error = Redact-SchedulerText $_.Exception.Message
  Add-SchedulerStage -Stage "failed" -Message $script:run.error
  Send-SchedulerFailureNotification -Kind "startup-failed" -Reason $script:run.error | Out-Null
  $exitCode = 1
} finally {
  $script:run.completedAt = (Get-Date).ToString("o")
  if ($null -eq $script:run.exitCode) { $script:run.exitCode = $exitCode }
  Save-SchedulerState
  Copy-Item -LiteralPath $script:logPath -Destination $script:latestLogPath -Force
}
exit $exitCode
