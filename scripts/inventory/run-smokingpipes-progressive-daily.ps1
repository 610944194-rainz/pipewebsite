$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\NING MEI\Desktop\pipewebsite"
$LogPath = Join-Path $ProjectRoot "data\review\smokingpipes-daily-task-latest.log"
$EnvPath = Join-Path $ProjectRoot ".env.inventory.local"
$AuditPath = Join-Path $ProjectRoot "data\review\smokingpipes-progressive-partial-audit-report.json"
$DailyTaskStatePath = Join-Path $ProjectRoot "data\inventory\smokingpipes-daily-task-state.json"
$DailyTaskLockPath = Join-Path $ProjectRoot "data\inventory\smokingpipes-daily-task-lock.json"
$ProgressiveLockPath = Join-Path $ProjectRoot "data\inventory\state\smokingpipes-progressive-daily.lock"
$ProgressiveLockRelativePath = "data/inventory/state/smokingpipes-progressive-daily.lock"
$ProgressiveLockHelperPath = "scripts/inventory/smokingpipes-progressive-lock-v1.mjs"
$CurrentListPath = "data/inventory/smokingpipes-current-list-dry-run.json"
$CurrentListCacheHelperPath = "scripts/inventory/smokingpipes-current-list-cache-v1.mjs"
$DiffPath = "data/inventory/smokingpipes-inventory-diff-dry-run.json"
$LockStaleHours = 4
$RetryDelayHours = 2
$CurrentListState = [ordered]@{
  status = "skipped"
  reused = $false
  path = $CurrentListPath
  pagesScanned = 0
  expectedPages = 0
  productsExtracted = 0
  lastCompletedAt = $null
  reuseReason = $null
}
$ProgressiveLockState = [ordered]@{
  exists = $false
  status = "missing"
  path = $ProgressiveLockRelativePath
  ageMs = 0
  cleared = $false
  reason = "missing"
}

Set-Location $ProjectRoot
New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $DailyTaskStatePath) | Out-Null

function Write-DailyLog {
  param([string]$Message)
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Import-InventoryEnv {
  if (-not (Test-Path $EnvPath)) {
    Write-DailyLog "env file not found: $EnvPath"
    return
  }

  foreach ($line in Get-Content -Path $EnvPath -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }

    $index = $trimmed.IndexOf("=")
    $name = $trimmed.Substring(0, $index).Trim()
    $value = $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")

    if ($name) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Invoke-InventoryNode {
  param(
    [string]$StepName,
    [string[]]$Arguments,
    [switch]$ContinueOnFailure
  )

  Write-DailyLog "START $StepName"
  Add-Content -Path $LogPath -Value ("node " + ($Arguments -join " ")) -Encoding UTF8
  & node @Arguments 2>&1 | Tee-Object -FilePath $LogPath -Append
  $exitCode = $LASTEXITCODE
  Write-DailyLog "EXIT $StepName $exitCode"

  if ($exitCode -ne 0 -and -not $ContinueOnFailure) {
    throw "$StepName failed with exit code $exitCode"
  }

  return $exitCode
}

function Test-AuditAllowsProductionWrite {
  if (-not (Test-Path $AuditPath)) {
    Write-DailyLog "audit missing; production write blocked"
    return $false
  }

  $audit = Get-Content -Path $AuditPath -Encoding UTF8 | ConvertFrom-Json
  $auditStatus = if ($audit.auditStatus) { $audit.auditStatus } elseif ($audit.verdict) { $audit.verdict } else { "" }
  $counts = if ($audit.counts) { $audit.counts } else { [pscustomobject]@{} }
  $blockers = @($audit.blockers)
  $candidateCount = [int]($audit.candidateCount)
  $wouldApplyCount = [int]($audit.wouldApplyCount)
  $deletedProducts = [int]($counts.deletedProducts)
  $pendingLeak = [int]($counts.pendingLeak)
  $failedLeak = [int]($counts.failedLeak)
  $blockedLeak = [int]($counts.blockedLeak)
  $reviewOnlyLeak = [int]($counts.reviewOnlyLeak)
  $zeroPriceSellable = [int]($counts.zeroPriceSellable)

  $allowed =
    $auditStatus -eq "PASS" -and
    $candidateCount -eq $wouldApplyCount -and
    $candidateCount -gt 0 -and
    $deletedProducts -eq 0 -and
    $pendingLeak -eq 0 -and
    $failedLeak -eq 0 -and
    $blockedLeak -eq 0 -and
    $reviewOnlyLeak -eq 0 -and
    $zeroPriceSellable -eq 0 -and
    $blockers.Count -eq 0

  Write-DailyLog "auditStatus=$auditStatus candidateCount=$candidateCount wouldApplyCount=$wouldApplyCount applyAllowed=$allowed"
  return $allowed
}

function Get-TodayDateKey {
  return (Get-Date).ToString("yyyy-MM-dd")
}

function Read-DailyTaskState {
  if (-not (Test-Path $DailyTaskStatePath)) {
    return $null
  }

  try {
    return Get-Content -Path $DailyTaskStatePath -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Write-DailyLog "daily task state unreadable: $($_.Exception.Message)"
    return $null
  }
}

function Write-DailyTaskState {
  param(
    [string]$Status,
    [int]$Attempts,
    [bool]$ProductionWritten = $false,
    [int]$AppliedCount = 0,
    [int]$CandidateCount = 0,
    [string]$FailureReason = $null,
    [string]$FailureType = $null,
    [bool]$RetryAllowed = $true,
    [string]$NextRetryRecommendedAt = $null,
    [object]$CurrentList = $null,
    [object]$ProgressiveLock = $null
  )

  $now = Get-Date
  $currentListForState = if ($CurrentList) { $CurrentList } else { $script:CurrentListState }
  $progressiveLockForState = if ($ProgressiveLock) { $ProgressiveLock } else { $script:ProgressiveLockState }
  $state = [ordered]@{
    source = "smokingpipes"
    dateKey = Get-TodayDateKey
    status = $Status
    attempts = $Attempts
    lastAttemptAt = $now.ToString("o")
    lastSuccessAt = $null
    lastFailureAt = $null
    lastFailureReason = $FailureReason
    lastFailureType = $FailureType
    productionWritten = $ProductionWritten
    appliedCount = $AppliedCount
    candidateCount = $CandidateCount
    nextRetryRecommendedAt = $NextRetryRecommendedAt
    retryAllowed = $RetryAllowed
    currentList = $currentListForState
    progressiveLock = $progressiveLockForState
  }

  if ($Status -eq "success" -or $Status -eq "skipped-success") {
    $state.lastSuccessAt = $now.ToString("o")
  }

  if ($Status -eq "retryable-failed" -or $Status -eq "terminal-failed") {
    $state.lastFailureAt = $now.ToString("o")
  }

  $state | ConvertTo-Json -Depth 6 | Set-Content -Path $DailyTaskStatePath -Encoding UTF8
}

function Convert-ProgressiveLockInspectionToState {
  param(
    [object]$Inspection,
    [string]$Status,
    [bool]$Cleared = $false
  )

  return [ordered]@{
    exists = [bool]($Inspection.exists)
    status = $Status
    path = $ProgressiveLockRelativePath
    ageMs = [int64]($Inspection.ageMs)
    cleared = $Cleared
    reason = if ($Inspection.reason) { [string]$Inspection.reason } else { $Status }
    pid = if ($Inspection.pid) { [int]($Inspection.pid) } else { $null }
    processAlive = $Inspection.processAlive
  }
}

function Get-ProgressiveLockInspection {
  try {
    $output = & node $ProgressiveLockHelperPath "--path=$ProgressiveLockPath" 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
      return [pscustomobject]@{
        exists = $true
        path = $ProgressiveLockRelativePath
        ageMs = 0
        stale = $false
        pid = $null
        processAlive = $null
        reason = "helper-failed"
      }
    }

    return ($output -join "`n") | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{
      exists = $true
      path = $ProgressiveLockRelativePath
      ageMs = 0
      stale = $false
      pid = $null
      processAlive = $null
      reason = "helper-error"
    }
  }
}

function Clear-StaleProgressiveLock {
  try {
    $output = & node $ProgressiveLockHelperPath "--path=$ProgressiveLockPath" "--clear-stale" 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
      throw "progressive lock helper failed with exit code $exitCode"
    }

    return ($output -join "`n") | ConvertFrom-Json
  } catch {
    Write-DailyLog "progressive lock cleanup failed: $($_.Exception.Message)"
    return [pscustomobject]@{
      cleared = $false
      reason = "cleanup-failed"
    }
  }
}

function Test-ProgressiveLockBeforeStage {
  param([string]$StageName)

  $inspection = Get-ProgressiveLockInspection

  if (-not $inspection.exists) {
    $script:ProgressiveLockState = Convert-ProgressiveLockInspectionToState `
      -Inspection $inspection `
      -Status "missing" `
      -Cleared $false
    Write-DailyLog "CHECK progressive lock: missing before $StageName"
    return $true
  }

  if ($inspection.stale -eq $true) {
    Write-DailyLog "CHECK progressive lock: stale before $StageName"
    $clearResult = Clear-StaleProgressiveLock
    $script:ProgressiveLockState = Convert-ProgressiveLockInspectionToState `
      -Inspection $inspection `
      -Status "stale-cleared" `
      -Cleared ([bool]($clearResult.cleared))
    if ($clearResult.cleared -eq $true) {
      Write-DailyLog "CLEARED stale progressive lock: $ProgressiveLockRelativePath"
      Write-DailyTaskState `
        -Status "running" `
        -Attempts $attempts `
        -RetryAllowed $true `
        -ProgressiveLock $script:ProgressiveLockState
      return $true
    }

    Write-DailyTaskState `
      -Status "retryable-failed" `
      -Attempts $attempts `
      -FailureReason "stale progressive lock cleanup failed" `
      -FailureType "lock" `
      -RetryAllowed $true `
      -NextRetryRecommendedAt (Get-NextRetryAt) `
      -ProgressiveLock $script:ProgressiveLockState
    Send-MobileReport
    return $false
  }

  $script:ProgressiveLockState = Convert-ProgressiveLockInspectionToState `
    -Inspection $inspection `
    -Status "active-skip" `
    -Cleared $false
  Write-DailyLog "CHECK progressive lock: active before $StageName"
  Write-DailyLog "SKIP because progressive lock is active; next retry will continue"
  Write-DailyTaskState `
    -Status "retryable-failed" `
    -Attempts $attempts `
    -CandidateCount (Get-AuditCandidateCount) `
    -FailureReason "active progressive lock; another Smokingpipes inventory task is running" `
    -FailureType "lock" `
    -RetryAllowed $true `
    -NextRetryRecommendedAt (Get-NextRetryAt) `
    -ProgressiveLock $script:ProgressiveLockState
  Send-MobileReport
  return $false
}

function Get-NextRetryAt {
  return (Get-Date).AddHours($RetryDelayHours).ToString("o")
}

function Get-ExistingAttemptCount {
  param([object]$State)

  if ($State -and $State.dateKey -eq (Get-TodayDateKey)) {
    return [int]($State.attempts)
  }

  return 0
}

function Get-FailureType {
  param([string]$Message)

  if ($Message -match "zeroPriceSellable|failedLeak|blockedLeak|reviewOnlyLeak|pendingLeak|deletedProducts|candidateCount|wouldApplyCount|audit gate|auditStatus|public catalog validation|production write guard") {
    return "audit"
  }

  if ($Message -match "lock|already running|profile already in use") {
    return "lock"
  }

  if ($Message -match "strong verification|verification detected|manual verification|captcha|blocked") {
    return "verification"
  }

  if ($Message -match "timeout|fetch failed|network") {
    return "network"
  }

  if ($Message -match "browser|context") {
    return "browser"
  }

  return "unknown"
}

function Test-FailureIsRetryable {
  param([string]$FailureType)

  return @("lock", "verification", "network", "browser", "unknown") -contains $FailureType
}

function Get-AuditCandidateCount {
  if (-not (Test-Path $AuditPath)) {
    return 0
  }

  try {
    $audit = Get-Content -Path $AuditPath -Encoding UTF8 | ConvertFrom-Json
    return [int]($audit.candidateCount)
  } catch {
    return 0
  }
}

function Get-CurrentListCacheStatus {
  try {
    $output = & node $CurrentListCacheHelperPath "--path=$CurrentListPath" 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
      return [pscustomobject]@{
        usable = $false
        reason = "cache-helper-failed"
        path = $CurrentListPath
        pagesScanned = 0
        expectedPages = 0
        productsExtracted = 0
        uniqueProducts = 0
        completedAt = $null
      }
    }

    return ($output -join "`n") | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{
      usable = $false
      reason = "cache-helper-error: $($_.Exception.Message)"
      path = $CurrentListPath
      pagesScanned = 0
      expectedPages = 0
      productsExtracted = 0
      uniqueProducts = 0
      completedAt = $null
    }
  }
}

function Convert-CurrentListCacheToState {
  param(
    [object]$Cache,
    [string]$Status,
    [bool]$Reused
  )

  return [ordered]@{
    status = $Status
    reused = $Reused
    path = $CurrentListPath
    pagesScanned = [int]($Cache.pagesScanned)
    expectedPages = [int]($Cache.expectedPages)
    productsExtracted = [int]($Cache.productsExtracted)
    lastCompletedAt = if ($Cache.completedAt) { [string]$Cache.completedAt } else { $null }
    reuseReason = if ($Cache.reason) { [string]$Cache.reason } else { $null }
  }
}

function Test-DailyTaskLockIsStale {
  param([object]$Lock)

  if (-not $Lock -or -not $Lock.startedAt) {
    return $true
  }

  try {
    $startedAt = [datetime]$Lock.startedAt
    return $startedAt -lt (Get-Date).AddHours(-1 * $LockStaleHours)
  } catch {
    return $true
  }
}

function Acquire-DailyTaskLock {
  if (Test-Path $DailyTaskLockPath) {
    $existingLock = $null

    try {
      $existingLock = Get-Content -Path $DailyTaskLockPath -Encoding UTF8 | ConvertFrom-Json
    } catch {
      $existingLock = $null
    }

    if (-not (Test-DailyTaskLockIsStale -Lock $existingLock)) {
      Write-DailyLog "DAILY TASK SKIPPED: another daily task is already running"
      return $false
    }

    Write-DailyLog "stale daily task lock removed"
    Remove-Item -LiteralPath $DailyTaskLockPath -Force
  }

  $lock = [ordered]@{
    source = "smokingpipes"
    pid = $PID
    startedAt = (Get-Date).ToString("o")
    staleAfterHours = $LockStaleHours
  }
  $lock | ConvertTo-Json -Depth 4 | Set-Content -Path $DailyTaskLockPath -Encoding UTF8
  return $true
}

function Release-DailyTaskLock {
  if (Test-Path $DailyTaskLockPath) {
    Remove-Item -LiteralPath $DailyTaskLockPath -Force
  }
}

function Send-MobileReport {
  Invoke-InventoryNode -StepName "mobile-report" -Arguments @(
    "scripts/inventory/smokingpipes-daily-mobile-report-v1.mjs",
    "--send"
  ) -ContinueOnFailure | Out-Null
}

Set-Content -Path $LogPath -Value "=== SMOKINGPIPES PROGRESSIVE DAILY START $(Get-Date -Format o) ===" -Encoding UTF8

$dailyTaskState = Read-DailyTaskState
$attempts = (Get-ExistingAttemptCount -State $dailyTaskState) + 1
$lockAcquired = $false

if (
  $dailyTaskState -and
  $dailyTaskState.dateKey -eq (Get-TodayDateKey) -and
  ($dailyTaskState.status -eq "success" -or $dailyTaskState.status -eq "skipped-success") -and
  $dailyTaskState.productionWritten -eq $true
) {
  Write-DailyLog "DAILY TASK SKIPPED: today already completed successfully"
  Write-DailyTaskState `
    -Status "skipped-success" `
    -Attempts ([int]($dailyTaskState.attempts)) `
    -ProductionWritten $true `
    -AppliedCount ([int]($dailyTaskState.appliedCount)) `
    -CandidateCount ([int]($dailyTaskState.candidateCount)) `
    -RetryAllowed $false
  Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
  exit 0
}

if (
  $dailyTaskState -and
  $dailyTaskState.dateKey -eq (Get-TodayDateKey) -and
  $dailyTaskState.status -eq "terminal-failed" -and
  $dailyTaskState.retryAllowed -eq $false
) {
  Write-DailyLog "DAILY TASK SKIPPED: terminal failure already recorded today"
  Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
  exit 0
}

if (
  $dailyTaskState -and
  $dailyTaskState.dateKey -eq (Get-TodayDateKey) -and
  $dailyTaskState.status -eq "retryable-failed" -and
  $dailyTaskState.nextRetryRecommendedAt
) {
  try {
    if ([datetime]$dailyTaskState.nextRetryRecommendedAt -gt (Get-Date)) {
      Write-DailyLog "DAILY TASK SKIPPED: retry window has not arrived"
      Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
      exit 0
    }
  } catch {
    Write-DailyLog "retry window parse failed; continuing"
  }
}

if (-not (Acquire-DailyTaskLock)) {
  Write-DailyTaskState `
    -Status "retryable-failed" `
    -Attempts $attempts `
    -FailureReason "已有任务正在运行" `
    -FailureType "lock" `
    -RetryAllowed $true `
    -NextRetryRecommendedAt (Get-NextRetryAt)
  Send-MobileReport
  Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
  exit 0
}

$lockAcquired = $true
Write-DailyTaskState -Status "running" -Attempts $attempts -RetryAllowed $true

try {
  Import-InventoryEnv

  $currentListCache = Get-CurrentListCacheStatus

  if ($currentListCache.usable -eq $true) {
    $script:CurrentListState = Convert-CurrentListCacheToState `
      -Cache $currentListCache `
      -Status "reused" `
      -Reused $true
    Write-DailyLog "REUSE current-list cache: $CurrentListPath pages=$($currentListCache.pagesScanned)/$($currentListCache.expectedPages) products=$($currentListCache.productsExtracted)"
    Write-DailyTaskState `
      -Status "running" `
      -Attempts $attempts `
      -RetryAllowed $true `
      -CurrentList $script:CurrentListState
  } else {
    Write-DailyLog "current-list cache not reusable: $($currentListCache.reason)"
    Invoke-InventoryNode -StepName "current-list" -Arguments @(
      "scripts/inventory/run-inventory-automation-v1.mjs",
      "--source=smokingpipes",
      "--mode=dry-run",
      "--max-pages=107",
      "--allow-manual-verification=true",
      "--browser-channel=chrome",
      "--browser-profile=sp-chrome",
      "--skip-new-details",
      "--no-commit",
      "--no-deploy",
      "--verbose"
    )
    $currentListCache = Get-CurrentListCacheStatus

    if ($currentListCache.usable -eq $true) {
      $script:CurrentListState = Convert-CurrentListCacheToState `
        -Cache $currentListCache `
        -Status "fetched" `
        -Reused $false
      Write-DailyTaskState `
        -Status "running" `
        -Attempts $attempts `
        -RetryAllowed $true `
        -CurrentList $script:CurrentListState
    } else {
      $script:CurrentListState = [ordered]@{
        status = "failed"
        reused = $false
        path = $CurrentListPath
        pagesScanned = [int]($currentListCache.pagesScanned)
        expectedPages = [int]($currentListCache.expectedPages)
        productsExtracted = [int]($currentListCache.productsExtracted)
        lastCompletedAt = $null
        reuseReason = [string]($currentListCache.reason)
      }
      Write-DailyTaskState `
        -Status "retryable-failed" `
        -Attempts $attempts `
        -FailureReason "current-list cache not reusable after fetch: $($currentListCache.reason)" `
        -FailureType "network" `
        -RetryAllowed $true `
        -NextRetryRecommendedAt (Get-NextRetryAt) `
        -CurrentList $script:CurrentListState
      throw "current-list cache not reusable after fetch: $($currentListCache.reason)"
    }
  }

  if (-not (Test-ProgressiveLockBeforeStage -StageName "progressive-ingest-list")) {
    Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
    exit 0
  }

  Invoke-InventoryNode -StepName "progressive-ingest-list" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=progressive-ingest-list",
    "--current-list=$CurrentListPath",
    "--diff=$DiffPath",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  )

  if (-not (Test-ProgressiveLockBeforeStage -StageName "progressive-detail-chunk")) {
    Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
    exit 0
  }

  $detailExit = Invoke-InventoryNode -StepName "progressive-detail-chunk" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=progressive-detail-chunk",
    "--progressive-detail-max=30",
    "--browser-channel=chrome",
    "--browser-profile=sp-chrome",
    "--allow-manual-verification=true",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  ) -ContinueOnFailure

  if ($detailExit -ne 0) {
    $failureReason = "progressive-detail-chunk failed before production write with exit code $detailExit"
    $failureType = Get-FailureType -Message $failureReason
    Write-DailyLog "detail chunk blocked or failed; production write skipped"
    Write-DailyTaskState `
      -Status "retryable-failed" `
      -Attempts $attempts `
      -CandidateCount (Get-AuditCandidateCount) `
      -FailureReason $failureReason `
      -FailureType $failureType `
      -RetryAllowed $true `
      -NextRetryRecommendedAt (Get-NextRetryAt)
    Send-MobileReport
    exit $detailExit
  }

  if (-not (Test-ProgressiveLockBeforeStage -StageName "progressive-build-candidate")) {
    Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
    exit 0
  }

  Invoke-InventoryNode -StepName "progressive-build-candidate" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=progressive-build-candidate",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  )

  if (Test-AuditAllowsProductionWrite) {
    if (-not (Test-ProgressiveLockBeforeStage -StageName "progressive-partial-apply")) {
      Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
      exit 0
    }

    Invoke-InventoryNode -StepName "progressive-partial-apply" -Arguments @(
      "scripts/inventory/run-inventory-automation-v1.mjs",
      "--source=smokingpipes",
      "--mode=progressive-partial-apply",
      "--write-production",
      "--no-commit",
      "--no-deploy",
      "--verbose"
    )
  } else {
    Write-DailyLog "audit gate blocked production write"
    Write-DailyTaskState `
      -Status "terminal-failed" `
      -Attempts $attempts `
      -CandidateCount (Get-AuditCandidateCount) `
      -FailureReason "安全审计未通过，已停止自动重试" `
      -FailureType "audit" `
      -RetryAllowed $false
    Send-MobileReport
    Write-DailyLog "DAILY TASK TERMINAL FAILED"
    exit 0
  }

  $candidateCount = Get-AuditCandidateCount
  Write-DailyTaskState `
    -Status "success" `
    -Attempts $attempts `
    -ProductionWritten $true `
    -AppliedCount $candidateCount `
    -CandidateCount $candidateCount `
    -RetryAllowed $false
  Send-MobileReport
  Write-DailyLog "DAILY TASK COMPLETE"
} catch {
  $failureReason = $_.Exception.Message
  $failureType = Get-FailureType -Message $failureReason
  $retryAllowed = Test-FailureIsRetryable -FailureType $failureType
  $status = if ($retryAllowed) { "retryable-failed" } else { "terminal-failed" }
  $nextRetry = if ($retryAllowed) { Get-NextRetryAt } else { $null }
  Write-DailyLog "DAILY TASK FAILED: $failureReason"
  Write-DailyTaskState `
    -Status $status `
    -Attempts $attempts `
    -CandidateCount (Get-AuditCandidateCount) `
    -FailureReason $failureReason `
    -FailureType $failureType `
    -RetryAllowed $retryAllowed `
    -NextRetryRecommendedAt $nextRetry
  Send-MobileReport
  exit 1
} finally {
  if ($lockAcquired) {
    Release-DailyTaskLock
  }
  Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
}
