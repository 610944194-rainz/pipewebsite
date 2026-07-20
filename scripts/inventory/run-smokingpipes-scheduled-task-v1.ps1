param(
  [string]$AutomationWorktree = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-run",
  [string]$BuildExecutable = "C:\Program Files\nodejs\npm.cmd",
  [ValidateRange(900, 14400)][int]$DailyTimeoutSeconds = 3600,
  [ValidatePattern('^[1-9]\d*$')][string]$MaxAutoApply = "1000",
  [ValidatePattern('^(?:|[A-Fa-f0-9]{64})$')][string]$LegacyDuplicateSnapshotSha256 = "",
  [switch]$ForceSameDayRerun
)

$ErrorActionPreference = "Stop"
$wrapper = Join-Path $AutomationWorktree "scripts\inventory\run-smokingpipes-auto-publish.ps1"
$sameDayGuardModule = Join-Path $AutomationWorktree "scripts\inventory\smokingpipes-daily-invocation-guard-v1.psm1"
$dailyTaskStatePath = Join-Path $AutomationWorktree "data\inventory\smokingpipes-daily-task-state.json"
$logRoot = Join-Path $AutomationWorktree "data\review\smokingpipes-scheduled-logs"

$exitCode = 1
$transcriptStarted = $false
try {
  New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  $logPath = Join-Path $logRoot ("smokingpipes-daily-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
  Start-Transcript -LiteralPath $logPath -Force | Out-Null
  $transcriptStarted = $true
  Write-Output "[INFO] scheduled launcher started pid=$PID"

  if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw "Smokingpipes auto-publish wrapper is missing: $wrapper" }
  if (-not (Test-Path -LiteralPath $BuildExecutable -PathType Leaf)) { throw "Build executable is missing: $BuildExecutable" }
  if (-not (Test-Path -LiteralPath $sameDayGuardModule -PathType Leaf)) { throw "Smokingpipes same-day guard module is missing: $sameDayGuardModule" }

  Write-Output "[INFO] same-day guard start"
  Import-Module -Name $sameDayGuardModule -Force
  $sameDayDecision = Test-SmokingpipesSameDaySuccess `
    -State (Read-SmokingpipesDailyTaskState -Path $dailyTaskStatePath) `
    -ForceSameDayRerun:$ForceSameDayRerun
  Write-Output "[INFO] same-day guard result shouldSkip=$($sameDayDecision.ShouldSkip) reason=$($sameDayDecision.Reason)"
  if ($sameDayDecision.ShouldSkip) {
    Write-Output "same-day-success-already-completed"
    $exitCode = 0
  } else {
    & $wrapper `
      -AutomationWorktree $AutomationWorktree `
      -BuildExecutable $BuildExecutable `
      -DailyTimeoutSeconds $DailyTimeoutSeconds `
      -MaxAutoApply $MaxAutoApply `
      -LegacyDuplicateSnapshotSha256 $LegacyDuplicateSnapshotSha256 `
      -ForceRunOnce `
      -ForceSameDayRerun:$ForceSameDayRerun
    $exitCode = $LASTEXITCODE
  }
} catch {
  Write-Error ("[ERROR] scheduled launcher failed type={0} message={1}" -f $_.Exception.GetType().FullName, $_.Exception.Message)
  $exitCode = 1
} finally {
  if ($transcriptStarted) {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
  }
}
exit $exitCode
