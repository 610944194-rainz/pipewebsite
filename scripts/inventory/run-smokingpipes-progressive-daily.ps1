param(
  [switch]$PreflightOnly,
  [switch]$ForceRunOnce,
  [switch]$SkipCurrentList,
  [switch]$AllowStaleCurrentListCache,
  [switch]$AllowDuplicateDedupe,
  [switch]$ResumeFromCachedList,
  [switch]$LockCurrentListSnapshotUntilComplete,
  [switch]$SafeBootstrap,
  [switch]$NoProductionWrite,
  [ValidatePattern('^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$')]
  [string]$ProgressiveDetailMax = "30"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LogPath = Join-Path $ProjectRoot "data\review\smokingpipes-daily-task-latest.log"
$EnvPath = Join-Path $ProjectRoot ".env.inventory.local"
$AuditPath = Join-Path $ProjectRoot "data\review\smokingpipes-progressive-partial-audit-report.json"
$ApplyPreviewPath = Join-Path $ProjectRoot "data\review\smokingpipes-progressive-partial-apply-preview.json"
$ApplyGateReportPath = Join-Path $ProjectRoot "data\review\smokingpipes-progressive-apply-gate-report.json"
$DailyTaskStatePath = Join-Path $ProjectRoot "data\inventory\smokingpipes-daily-task-state.json"
$DailyTaskLockPath = Join-Path $ProjectRoot "data\inventory\smokingpipes-daily-task-lock.json"
$GlobalInventoryLockPath = Join-Path $ProjectRoot "data\inventory\state\smokingpipes.lock"
$GlobalInventoryLockRelativePath = "data/inventory/state/smokingpipes.lock"
$InventoryLockHelperPath = "scripts/inventory/smokingpipes-inventory-lock-v1.mjs"
$ProgressiveLockPath = Join-Path $ProjectRoot "data\inventory\state\smokingpipes-progressive-daily.lock"
$ProgressiveLockRelativePath = "data/inventory/state/smokingpipes-progressive-daily.lock"
$ProgressiveLockHelperPath = "scripts/inventory/smokingpipes-progressive-lock-v1.mjs"
$CurrentListPath = "data/inventory/smokingpipes-current-list-dry-run.json"
$CurrentListCacheHelperPath = "scripts/inventory/smokingpipes-current-list-cache-v1.mjs"
$RecoveryPreflightHelperPath = "scripts/inventory/smokingpipes-daily-recovery-preflight-v1.mjs"
$RecoveryPreflightReportJsonPath = Join-Path $ProjectRoot "data\review\smokingpipes-daily-recovery-preflight-report.json"
$DiffPath = "data/inventory/smokingpipes-inventory-diff-dry-run.json"
$LockStaleHours = 4
$RetryDelayHours = 2
$PreflightOnlyEffective = $false
$ForceRunOnceEffective = $false
$SkipCurrentListEffective = $false
$AllowStaleCurrentListCacheEffective = $false
$AllowDuplicateDedupeEffective = $false
$ResumeFromCachedListEffective = $false
$LockCurrentListSnapshotUntilCompleteEffective = $false
$NoProductionWriteEffective = $false
$LastInventoryNodeResult = $null
$LastInventoryNodeOutput = @()
$DetailPhaseStatus = $null
$DetailPendingCount = 0
$DetailCompletedThisRun = 0
$DetailQueueSpikeState = $null
$CurrentListState = [ordered]@{
  status = "skipped"
  reused = $false
  skippedFetch = $false
  stale = $false
  manualRecovery = $false
  path = $CurrentListPath
  pagesScanned = 0
  expectedPages = 0
  productsExtracted = 0
  lastCompletedAt = $null
  reuseReason = $null
  safety = [ordered]@{
    soldByAbsenceAllowed = $false
    disappearedApplyAllowed = $false
  }
}
$CachedListResumeState = [ordered]@{
  enabled = $false
  snapshotPath = $CurrentListPath
  snapshotDateKey = $null
  snapshotProductsExtracted = 0
  snapshotUniqueProducts = 0
  lockedUntilComplete = $false
  completed = $false
  completedAt = $null
  allowNextListFetch = $true
  allowDuplicateDedupe = $false
  reason = $null
}
$ProgressiveLockState = [ordered]@{
  exists = $false
  status = "missing"
  path = $ProgressiveLockRelativePath
  ageMs = 0
  cleared = $false
  reason = "missing"
}
$InventoryLocksState = [ordered]@{
  checked = $false
  locks = @()
  hasActiveLock = $false
  activeLocks = @()
  clearedLocks = @()
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

function Test-TruthyEnvFlag {
  param([string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  return $value -match "^(1|true|yes|on)$"
}

function Resolve-ManualRecoveryOptions {
  $script:PreflightOnlyEffective = [bool]$PreflightOnly
  $cachedListResumeLocked = (
    $dailyTaskState -and
    $dailyTaskState.cachedListResume -and
    $dailyTaskState.cachedListResume.enabled -eq $true -and
    $dailyTaskState.cachedListResume.lockedUntilComplete -eq $true -and
    $dailyTaskState.cachedListResume.completed -ne $true -and
    $dailyTaskState.cachedListResume.allowNextListFetch -eq $false
  )
  $script:ResumeFromCachedListEffective =
    [bool]$ResumeFromCachedList -or
    (Test-TruthyEnvFlag -Name "YAN_DOUBUY_RESUME_FROM_CACHED_LIST") -or
    [bool]$cachedListResumeLocked
  $script:LockCurrentListSnapshotUntilCompleteEffective =
    [bool]$LockCurrentListSnapshotUntilComplete -or
    (Test-TruthyEnvFlag -Name "YAN_DOUBUY_LOCK_CURRENT_LIST_SNAPSHOT_UNTIL_COMPLETE") -or
    [bool]$cachedListResumeLocked
  $script:ForceRunOnceEffective =
    [bool]$ForceRunOnce -or (Test-TruthyEnvFlag -Name "YAN_DOUBUY_FORCE_RUN_ONCE")
  $script:SkipCurrentListEffective =
    [bool]$SkipCurrentList -or
    (Test-TruthyEnvFlag -Name "YAN_DOUBUY_SKIP_CURRENT_LIST") -or
    $script:ResumeFromCachedListEffective
  $script:AllowStaleCurrentListCacheEffective =
    [bool]$AllowStaleCurrentListCache -or
    (Test-TruthyEnvFlag -Name "YAN_DOUBUY_ALLOW_STALE_CURRENT_LIST_CACHE") -or
    $script:ResumeFromCachedListEffective
  $script:AllowDuplicateDedupeEffective =
    [bool]$AllowDuplicateDedupe -or
    (Test-TruthyEnvFlag -Name "YAN_DOUBUY_ALLOW_DUPLICATE_DEDUPE") -or
    ($dailyTaskState.cachedListResume.allowDuplicateDedupe -eq $true)
  $script:NoProductionWriteEffective =
    [bool]$NoProductionWrite -or
    [bool]$SafeBootstrap -or
    (Test-TruthyEnvFlag -Name "YANDOUBUY_SMOKINGPIPES_DAILY_NO_PRODUCTION_WRITE")

  if ($script:PreflightOnlyEffective) {
    Write-DailyLog "manual recovery option enabled: PreflightOnly"
  }

  if ($cachedListResumeLocked) {
    Write-DailyLog "CACHED-LIST resume lock active: skip current-list until current snapshot is complete"
  }

  if ($script:ForceRunOnceEffective) {
    Write-DailyLog "manual recovery option enabled: ForceRunOnce"
  }

  if ($script:SkipCurrentListEffective) {
    Write-DailyLog "manual recovery option enabled: SkipCurrentList"
  }

  if ($script:AllowStaleCurrentListCacheEffective) {
    Write-DailyLog "manual recovery option enabled: AllowStaleCurrentListCache"
  }

  if ($script:AllowDuplicateDedupeEffective) {
    Write-DailyLog "manual recovery option enabled: AllowDuplicateDedupe"
  }

  if ($script:ResumeFromCachedListEffective) {
    Write-DailyLog "manual recovery option enabled: ResumeFromCachedList"
  }

  if ($script:LockCurrentListSnapshotUntilCompleteEffective) {
    Write-DailyLog "manual recovery option enabled: LockCurrentListSnapshotUntilComplete"
  }

  if ($script:NoProductionWriteEffective) {
    Write-DailyLog "safe bootstrap mode enabled: no production write"
  }
}

function ConvertFrom-InventoryNodeOutput {
  param([object[]]$OutputLines)

  $outputText = (@($OutputLines) | ForEach-Object { [string]$_ }) -join "`n"
  $jsonStart = $outputText.IndexOf("{")
  $jsonEnd = $outputText.LastIndexOf("}")
  if ($jsonStart -lt 0 -or $jsonEnd -le $jsonStart) {
    return $null
  }

  try {
    return $outputText.Substring($jsonStart, $jsonEnd - $jsonStart + 1) |
      ConvertFrom-Json
  } catch {
    return $null
  }
}

function Test-DetailPhaseCanContinue {
  param(
    [int]$ExitCode,
    [string]$Status
  )

  return (
    $ExitCode -eq 0 -and
    @("no-eligible-candidates", "chunk-complete", "completed", "success") -contains $Status
  )
}

function Test-RetryWindowReady {
  param(
    [datetime]$RecommendedAt,
    [datetime]$Now = (Get-Date),
    [int]$GraceSeconds = 60
  )

  return $RecommendedAt -le $Now.AddSeconds($GraceSeconds)
}

function Invoke-InventoryNode {
  param(
    [string]$StepName,
    [string[]]$Arguments,
    [switch]$ContinueOnFailure
  )

  $script:LastInventoryNodeResult = $null
  $script:LastInventoryNodeOutput = @()
  $null = Write-DailyLog "START $StepName"
  Add-Content -Path $LogPath -Value ("node " + ($Arguments -join " ")) -Encoding UTF8
  $nodeOutput = @(& node @Arguments 2>&1)
  $exitCode = [int]$LASTEXITCODE
  $script:LastInventoryNodeOutput = @(
    $nodeOutput | ForEach-Object { [string]$_ }
  )
  foreach ($line in $script:LastInventoryNodeOutput) {
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
    Write-Host $line
  }
  $script:LastInventoryNodeResult =
    ConvertFrom-InventoryNodeOutput -OutputLines $script:LastInventoryNodeOutput
  $null = Write-DailyLog "EXIT $StepName $exitCode"

  if ($exitCode -ne 0 -and -not $ContinueOnFailure) {
    throw "$StepName failed with exit code $exitCode"
  }

  return [int]$exitCode
}

function Get-TodayDateKey {
  return (Get-Date).ToString("yyyy-MM-dd")
}

function Read-DailyTaskState {
  if (-not (Test-Path $DailyTaskStatePath)) {
    return $null
  }

  try {
    $json = (Get-Content -Path $DailyTaskStatePath -Encoding UTF8 -Raw).TrimStart([char]0xFEFF)
    return $json | ConvertFrom-Json
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
    [int]$WouldApplyCount = 0,
    [int]$IsolatedCandidateCount = 0,
    [string]$FailureReason = $null,
    [string]$FailureType = $null,
    [bool]$RetryAllowed = $true,
    [string]$NextRetryRecommendedAt = $null,
    [object]$CurrentList = $null,
    [object]$InventoryLocks = $null,
    [object]$ProgressiveLock = $null,
    [object]$CachedListResume = $null,
    [string]$DetailPhaseStatus = $null,
    [object]$DetailPendingCount = $null,
    [object]$DetailPending = $null,
    [object]$DetailCompletedThisRun = $null,
    [object]$DetailQueueSpike = $null
  )

  $now = Get-Date
  $currentListForState = if ($CurrentList) { $CurrentList } else { $script:CurrentListState }
  $inventoryLocksForState = if ($InventoryLocks) { $InventoryLocks } else { $script:InventoryLocksState }
  $progressiveLockForState = if ($ProgressiveLock) { $ProgressiveLock } else { $script:ProgressiveLockState }
  $cachedListResumeForState = if ($CachedListResume) { $CachedListResume } else { $script:CachedListResumeState }
  $state = [ordered]@{
    source = "smokingpipes"
    runMode = if ($script:NoProductionWriteEffective) { "safe-bootstrap" } else { "daily-update" }
    safeBootstrap = [bool]$SafeBootstrap
    noProductionWrite = [bool]$script:NoProductionWriteEffective
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
    wouldApplyCount = $WouldApplyCount
    isolatedCandidateCount = $IsolatedCandidateCount
    progressiveDetailMax = [int]$ProgressiveDetailMax
    nextRetryRecommendedAt = $NextRetryRecommendedAt
    retryAllowed = $RetryAllowed
    currentList = $currentListForState
    inventoryLocks = $inventoryLocksForState
    progressiveLock = $progressiveLockForState
    cachedListResume = $cachedListResumeForState
    detailPhaseStatus = if ($DetailPhaseStatus) {
      $DetailPhaseStatus
    } else {
      $script:DetailPhaseStatus
    }
    detailPendingCount = if ($null -ne $DetailPendingCount) {
      [int]$DetailPendingCount
    } else {
      [int]$script:DetailPendingCount
    }
    detailPending = if ($null -ne $DetailPending) {
      [int]$DetailPending
    } elseif ($null -ne $DetailPendingCount) {
      [int]$DetailPendingCount
    } else {
      [int]$script:DetailPendingCount
    }
    detailCompletedThisRun = if ($null -ne $DetailCompletedThisRun) {
      [int]$DetailCompletedThisRun
    } else {
      [int]$script:DetailCompletedThisRun
    }
    detailQueueSpike = if ($null -ne $DetailQueueSpike) {
      $DetailQueueSpike
    } else {
      $script:DetailQueueSpikeState
    }
  }

  if ($Status -eq "success" -or $Status -eq "skipped-success") {
    $state.lastSuccessAt = $now.ToString("o")
  }

  if ($Status -in @("retryable-failed", "terminal-failed", "manual-review-required", "safety-gate-blocked")) {
    $state.lastFailureAt = $now.ToString("o")
  }

  $json = $state | ConvertTo-Json -Depth 6
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($DailyTaskStatePath, "$json`n", $utf8NoBom)
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

function Convert-InventoryLocksToState {
  param([object]$InventoryLocks)

  if (-not $InventoryLocks) {
    return [ordered]@{
      checked = $true
      locks = @()
      hasActiveLock = $true
      activeLocks = @()
      clearedLocks = @()
      reason = "helper-empty"
    }
  }

  return [ordered]@{
    checked = $true
    locks = @($InventoryLocks.locks)
    hasActiveLock = [bool]($InventoryLocks.hasActiveLock)
    activeLocks = @($InventoryLocks.activeLocks)
    clearedLocks = @($InventoryLocks.clearedLocks)
  }
}

function Convert-InventoryLockRecordToProgressiveState {
  param([object]$Lock)

  if (-not $Lock) {
    return [ordered]@{
      exists = $false
      status = "missing"
      path = $ProgressiveLockRelativePath
      ageMs = 0
      cleared = $false
      reason = "missing"
    }
  }

  $status = [string]($Lock.status)
  if ($status -eq "active") {
    $status = "active-skip"
  } elseif ($status -eq "cleared") {
    $status = "stale-cleared"
  }

  return [ordered]@{
    exists = [bool]($Lock.exists)
    status = $status
    path = $ProgressiveLockRelativePath
    ageMs = [int64]($Lock.ageMs)
    cleared = ($Lock.status -eq "cleared")
    reason = if ($Lock.reason) { [string]$Lock.reason } else { $status }
    pid = if ($Lock.pid) { [int]($Lock.pid) } else { $null }
    processAlive = $Lock.processAlive
  }
}

function Update-ProgressiveLockStateFromInventoryLocks {
  param([object]$InventoryLocks)

  $progressiveLock = @($InventoryLocks.locks) |
    Where-Object { $_.name -eq "progressiveDaily" } |
    Select-Object -First 1

  $script:ProgressiveLockState =
    Convert-InventoryLockRecordToProgressiveState -Lock $progressiveLock
}

function Get-InventoryLocksInspection {
  try {
    $output = & node $InventoryLockHelperPath "--clear-stale" 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
      throw "inventory lock helper failed with exit code $exitCode"
    }

    return ($output -join "`n") | ConvertFrom-Json
  } catch {
    Write-DailyLog "inventory lock check failed: $($_.Exception.Message)"
    return [pscustomobject]@{
      locks = @()
      hasActiveLock = $true
      activeLocks = @(
        [pscustomobject]@{
          name = "helper"
          path = "data/inventory/state"
          status = "active"
          reason = "helper-failed"
        }
      )
      clearedLocks = @()
    }
  }
}

function Get-LockFileName {
  param([string]$LockPath)

  if (-not $LockPath) {
    return "inventory lock"
  }

  return [System.IO.Path]::GetFileName($LockPath.Replace("/", "\"))
}

function Test-InventoryLocksBeforeStage {
  param([string]$StageName)

  $inspection = Get-InventoryLocksInspection
  $script:InventoryLocksState = Convert-InventoryLocksToState -InventoryLocks $inspection
  Update-ProgressiveLockStateFromInventoryLocks -InventoryLocks $inspection

  Write-DailyLog "CHECK inventory locks before ${StageName}: active=$($script:InventoryLocksState.hasActiveLock) cleared=$(@($script:InventoryLocksState.clearedLocks).Count)"

  foreach ($clearedLock in @($script:InventoryLocksState.clearedLocks)) {
    Write-DailyLog "CLEARED stale inventory lock: $(Get-LockFileName -LockPath ([string]$clearedLock.path))"
  }

  if ($script:InventoryLocksState.hasActiveLock -eq $true) {
    Write-DailyLog "SKIP because inventory lock is active; next retry will continue"
    Write-DailyTaskState `
      -Status "retryable-failed" `
      -Attempts $attempts `
      -CandidateCount (Get-AuditCandidateCount) `
      -FailureReason "active Smokingpipes inventory lock; another inventory task is running" `
      -FailureType "lock" `
      -RetryAllowed $true `
      -NextRetryRecommendedAt (Get-NextRetryAt) `
      -InventoryLocks $script:InventoryLocksState `
      -ProgressiveLock $script:ProgressiveLockState
    Send-MobileReport
    return $false
  }

  if (@($script:InventoryLocksState.clearedLocks).Count -gt 0) {
    Write-DailyTaskState `
      -Status "running" `
      -Attempts $attempts `
      -RetryAllowed $true `
      -InventoryLocks $script:InventoryLocksState `
      -ProgressiveLock $script:ProgressiveLockState
  }

  return $true
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

  if ($Message -match "preflight|预检|recovery preflight") {
    return "preflight"
  }

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

  return @("preflight", "lock", "verification", "network", "browser", "unknown") -contains $FailureType
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

function Clear-StaleProgressiveApplyReports {
  param([string]$Reason = "daily-start")

  Remove-Item -Path $AuditPath, $ApplyPreviewPath, $ApplyGateReportPath -Force -ErrorAction SilentlyContinue
  Write-DailyLog "cleared stale progressive audit/apply preview/gate reports: $Reason"
}

function Get-InventoryNodeFailureMessage {
  param([string]$Fallback = "inventory node failed")

  $lines = @($script:LastInventoryNodeOutput) |
    ForEach-Object { [string]$_ } |
    Where-Object { $_ -and $_.Trim() }

  $important = $lines |
    Where-Object {
      $_ -match "No products were extracted|parse failure|Timeout|Error:|strong verification|verification|captcha|Cloudflare|blocked"
    } |
    Select-Object -First 1

  if ($important) {
    return [string]$important
  }

  if ($lines.Count -gt 0) {
    return [string]($lines[-1])
  }

  return $Fallback
}

function Get-CurrentListCacheStatus {
  try {
    $cacheArgs = @("--path=$CurrentListPath")
    if ($script:AllowStaleCurrentListCacheEffective) {
      $cacheArgs += "--allow-stale"
    }
    if ($script:AllowDuplicateDedupeEffective) {
      $cacheArgs += "--allow-duplicate-dedupe"
    }
    $output = & node $CurrentListCacheHelperPath @cacheArgs 2>&1
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
    [bool]$Reused,
    [bool]$SkippedFetch = $false
  )

  return [ordered]@{
    status = $Status
    reused = $Reused
    skippedFetch = $SkippedFetch
    stale = [bool]($Cache.stale)
    manualRecovery = [bool]($Cache.manualRecovery)
    path = $CurrentListPath
    pagesScanned = [int]($Cache.pagesScanned)
    expectedPages = [int]($Cache.expectedPages)
    productsExtracted = [int]($Cache.productsExtracted)
    lastCompletedAt = if ($Cache.completedAt) { [string]$Cache.completedAt } else { $null }
    reuseReason = if ($Cache.reason) { [string]$Cache.reason } else { $null }
    safety = if ($Cache.safety) {
      $Cache.safety
    } else {
      [ordered]@{
        soldByAbsenceAllowed = -not [bool]($Cache.stale)
        disappearedApplyAllowed = -not [bool]($Cache.stale)
      }
    }
  }
}

function Convert-CurrentListCacheToCachedResumeState {
  param(
    [object]$Cache,
    [bool]$Completed = $false
  )

  return [ordered]@{
    enabled = [bool]($script:ResumeFromCachedListEffective)
    snapshotPath = $CurrentListPath
    snapshotDateKey = if ($Cache.dateKey) { [string]$Cache.dateKey } else { $null }
    snapshotProductsExtracted = [int]($Cache.productsExtracted)
    snapshotUniqueProducts = [int]($Cache.uniqueProducts)
    lockedUntilComplete = [bool]($script:LockCurrentListSnapshotUntilCompleteEffective)
    completed = $Completed
    completedAt = if ($Completed) { (Get-Date).ToString("o") } else { $null }
    allowNextListFetch =
      (-not [bool]($script:LockCurrentListSnapshotUntilCompleteEffective)) -or $Completed
    allowDuplicateDedupe = [bool]($script:AllowDuplicateDedupeEffective)
    reason = if ($script:ResumeFromCachedListEffective) {
      "resume detail processing from latest complete current-list cache"
    } else {
      $null
    }
  }
}

function Set-CachedListResumeFromCache {
  param(
    [object]$Cache,
    [bool]$Completed = $false
  )

  $script:CachedListResumeState =
    Convert-CurrentListCacheToCachedResumeState -Cache $Cache -Completed $Completed
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

function Get-RecoveryPreflightArguments {
  param([bool]$PreflightOnlyMode)

  $args = @($RecoveryPreflightHelperPath)
  if ($PreflightOnlyMode) {
    $args += "--preflight-only"
  } else {
    $args += "--clear-stale-locks"
  }
  if ($script:ForceRunOnceEffective) {
    $args += "--force-run-once"
  }
  if ($script:SkipCurrentListEffective) {
    $args += "--skip-current-list"
  }
  if ($script:AllowStaleCurrentListCacheEffective) {
    $args += "--allow-stale-current-list-cache"
  }
  if ($script:AllowDuplicateDedupeEffective) {
    $args += "--allow-duplicate-dedupe"
  }
  if ($script:ResumeFromCachedListEffective) {
    $args += "--resume-from-cached-list"
  }
  if ($script:LockCurrentListSnapshotUntilCompleteEffective) {
    $args += "--lock-current-list-snapshot-until-complete"
  }
  return $args
}

function Invoke-RecoveryPreflight {
  param([bool]$PreflightOnlyMode)

  $preflightArgs = Get-RecoveryPreflightArguments -PreflightOnlyMode $PreflightOnlyMode
  $modeText = if ($PreflightOnlyMode) { "preflight-only" } else { "execution-preflight" }
  $null = Write-DailyLog "START recovery-preflight $modeText"
  Add-Content -Path $LogPath -Value ("node " + ($preflightArgs -join " ")) -Encoding UTF8
  $preflightOutput = & node @preflightArgs 2>&1
  $exitCode = [int]$LASTEXITCODE
  foreach ($line in @($preflightOutput)) {
    Add-Content -Path $LogPath -Value ([string]$line) -Encoding UTF8
    Write-Host $line
  }
  $null = Write-DailyLog "EXIT recovery-preflight $exitCode"
  return [int]$exitCode
}

function Read-RecoveryPreflightReport {
  if (-not (Test-Path $RecoveryPreflightReportJsonPath)) {
    return $null
  }

  try {
    return Get-Content -Path $RecoveryPreflightReportJsonPath -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Write-DailyLog "recovery preflight report parse failed: $($_.Exception.Message)"
    return $null
  }
}

function Get-RecoveryPreflightBlockReason {
  param([object]$Report)

  if (-not $Report) {
    return "preflight JSON parse failed"
  }

  $errors = @($Report.errors)
  if ($errors.Count -gt 0) {
    return "preflight errors: $($errors -join '; ')"
  }

  if ([string]($Report.overall.status) -ne "ready") {
    return "preflight blocked: status=$($Report.overall.status)"
  }

  if ($Report.overall.canRun -ne $true) {
    return "preflight blocked: canRun=$($Report.overall.canRun)"
  }

  if ($script:SkipCurrentListEffective -eq $true -and $Report.overall.willFetchCurrentList -eq $true) {
    return "preflight unsafe: SkipCurrentList requested but execution plan would fetch current-list"
  }

  if (
    $script:ResumeFromCachedListEffective -eq $true -and
    $Report.networkPlan.willFetchCurrentList -eq $true
  ) {
    return "Blocked: cached-list resume is active; current-list fetch is forbidden until snapshot is complete."
  }

  if (
    $script:ResumeFromCachedListEffective -eq $true -and
    $Report.networkPlan.willFetchDetails -ne $true
  ) {
    return "preflight unsafe: cached-list resume did not enable detail fetching"
  }

  if (
    $script:SkipCurrentListEffective -eq $true -and
    $Report.executionPlan.skipCurrentList -ne $true
  ) {
    return "preflight unsafe: SkipCurrentList requested but execution plan did not keep skipCurrentList=true"
  }

  if (
    $script:SkipCurrentListEffective -eq $true -and
    $Report.currentListCache.usable -ne $true
  ) {
    return "preflight unsafe: current-list cache is not reusable"
  }

  return $null
}

function Write-RecoveryPreflightFailureAndExit {
  param(
    [string]$FailureReason,
    [int]$ExitCode = 1
  )

  Write-DailyTaskState `
    -Status "retryable-failed" `
    -Attempts $attempts `
    -FailureReason $FailureReason `
    -FailureType "preflight" `
    -RetryAllowed $true `
    -NextRetryRecommendedAt (Get-NextRetryAt)
  Send-MobileReport
  Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
  exit $ExitCode
}

Set-Content -Path $LogPath -Value "=== SMOKINGPIPES PROGRESSIVE DAILY START $(Get-Date -Format o) ===" -Encoding UTF8

$dailyTaskState = Read-DailyTaskState
$attempts = (Get-ExistingAttemptCount -State $dailyTaskState) + 1
$previousDetailPendingCount = if (
  $dailyTaskState -and
  $null -ne $dailyTaskState.detailPendingCount
) {
  [int]$dailyTaskState.detailPendingCount
} else {
  0
}
$script:DetailPendingCount = $previousDetailPendingCount
$script:DetailQueueSpikeState = if (
  $dailyTaskState -and
  $dailyTaskState.detailQueueSpike
) {
  $dailyTaskState.detailQueueSpike
} else {
  $null
}
$lockAcquired = $false

Import-InventoryEnv
Resolve-ManualRecoveryOptions
Write-DailyLog "progressive detail chunk size: $ProgressiveDetailMax"

if ($script:PreflightOnlyEffective) {
  $preflightExit = Invoke-RecoveryPreflight -PreflightOnlyMode $true
  Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
  exit $preflightExit
}

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
  $dailyTaskState.nextRetryRecommendedAt -and
  -not $script:ForceRunOnceEffective
) {
  try {
    $retryRecommendedAt = [datetime]$dailyTaskState.nextRetryRecommendedAt
    $retryNow = Get-Date
    if (-not (Test-RetryWindowReady -RecommendedAt $retryRecommendedAt -Now $retryNow)) {
      Write-DailyLog "DAILY TASK SKIPPED: retry window has not arrived"
      Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
      exit 0
    }
    if ($retryRecommendedAt -gt $retryNow) {
      Write-DailyLog "retry window grace applied"
    }
  } catch {
    Write-DailyLog "retry window parse failed; continuing"
  }
}

$preflightExit = Invoke-RecoveryPreflight -PreflightOnlyMode $false
if ($preflightExit -ne 0) {
  Write-RecoveryPreflightFailureAndExit `
    -FailureReason "Daily recovery preflight failed with exit code $preflightExit; see data/review/smokingpipes-daily-recovery-preflight-report.md" `
    -ExitCode $preflightExit
}

$preflightReport = Read-RecoveryPreflightReport
$preflightBlockReason = Get-RecoveryPreflightBlockReason -Report $preflightReport
if ($preflightBlockReason) {
  Write-RecoveryPreflightFailureAndExit `
    -FailureReason "$preflightBlockReason; see data/review/smokingpipes-daily-recovery-preflight-report.md" `
    -ExitCode 1
}

if ($script:ResumeFromCachedListEffective -eq $true) {
  Write-DailyLog "PREFLIGHT ready: continuing cached-list detail resume"
  Write-DailyLog "SKIP current-list: using cached list snapshot"
  if ($script:LockCurrentListSnapshotUntilCompleteEffective -eq $true) {
    Write-DailyLog "CACHED-LIST snapshot locked until detail/apply complete"
  }
} else {
  Write-DailyLog "PREFLIGHT ready: continuing recovery execution"
  if ($script:SkipCurrentListEffective -eq $true -and $preflightReport.overall.willFetchCurrentList -eq $false) {
    Write-DailyLog "SKIP current-list: using manual recovery current-list cache"
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
  if (-not (Test-InventoryLocksBeforeStage -StageName "daily-start")) {
    Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
    exit 0
  }

  Clear-StaleProgressiveApplyReports -Reason "before current-list"

  $currentListCache = Get-CurrentListCacheStatus

  if ($script:SkipCurrentListEffective -eq $true) {
    if ($currentListCache.usable -eq $true) {
      $script:CurrentListState = Convert-CurrentListCacheToState `
        -Cache $currentListCache `
        -Status "reused" `
        -Reused $true `
        -SkippedFetch $true
      if ($script:ResumeFromCachedListEffective -eq $true) {
        Set-CachedListResumeFromCache -Cache $currentListCache -Completed $false
      }
      if ($currentListCache.manualRecovery -eq $true) {
        Write-DailyLog "SKIP current-list: using manual recovery current-list cache"
      }
      Write-DailyLog "SKIP current-list fetch; reuse existing current-list cache: $CurrentListPath pages=$($currentListCache.pagesScanned)/$($currentListCache.expectedPages) products=$($currentListCache.productsExtracted) reason=$($currentListCache.reason)"
      Write-DailyTaskState `
        -Status "running" `
        -Attempts $attempts `
        -RetryAllowed $true `
        -CurrentList $script:CurrentListState `
        -CachedListResume $script:CachedListResumeState
    } else {
      $script:CurrentListState = [ordered]@{
        status = "skip-current-list-cache-unusable"
        reused = $false
        skippedFetch = $true
        stale = [bool]($currentListCache.stale)
        manualRecovery = [bool]($script:AllowStaleCurrentListCacheEffective)
        path = $CurrentListPath
        pagesScanned = [int]($currentListCache.pagesScanned)
        expectedPages = [int]($currentListCache.expectedPages)
        productsExtracted = [int]($currentListCache.productsExtracted)
        lastCompletedAt = $null
        reuseReason = [string]($currentListCache.reason)
        safety = [ordered]@{
          soldByAbsenceAllowed = $false
          disappearedApplyAllowed = $false
        }
      }
      Write-DailyTaskState `
        -Status "retryable-failed" `
        -Attempts $attempts `
        -FailureReason "SkipCurrentList requested but current-list cache is not reusable: $($currentListCache.reason)" `
        -FailureType "network" `
        -RetryAllowed $true `
        -NextRetryRecommendedAt (Get-NextRetryAt) `
        -CurrentList $script:CurrentListState `
        -CachedListResume $script:CachedListResumeState
      throw "SkipCurrentList requested but current-list cache is not reusable: $($currentListCache.reason)"
    }
  } elseif ($currentListCache.usable -eq $true) {
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
    $currentListExit = Invoke-InventoryNode -StepName "current-list" -Arguments @(
      "scripts/inventory/run-inventory-automation-v1.mjs",
      "--source=smokingpipes",
      "--mode=dry-run",
      "--max-pages=200",
      "--allow-manual-verification=true",
      "--browser-channel=chrome",
      "--browser-profile=sp-chrome",
      "--skip-new-details",
      "--no-commit",
      "--no-deploy",
      "--verbose"
    ) -ContinueOnFailure

    if ($currentListExit -ne 0) {
      $currentListFailureReason = Get-InventoryNodeFailureMessage `
        -Fallback "current-list failed with exit code $currentListExit"
      $script:CurrentListState = [ordered]@{
        status = "failed"
        reused = $false
        skippedFetch = $false
        stale = $false
        manualRecovery = $false
        path = $CurrentListPath
        pagesScanned = [int]($currentListCache.pagesScanned)
        expectedPages = [int]($currentListCache.expectedPages)
        productsExtracted = [int]($currentListCache.productsExtracted)
        lastCompletedAt = $null
        reuseReason = $currentListFailureReason
        safety = [ordered]@{
          soldByAbsenceAllowed = $false
          disappearedApplyAllowed = $false
        }
      }
      $script:DetailPhaseStatus = "not-started"
      Write-DailyTaskState `
        -Status "retryable-failed" `
        -Attempts $attempts `
        -ProductionWritten $false `
        -AppliedCount 0 `
        -CandidateCount 0 `
        -WouldApplyCount 0 `
        -IsolatedCandidateCount 0 `
        -FailureReason $currentListFailureReason `
        -FailureType "current-list" `
        -RetryAllowed $true `
        -NextRetryRecommendedAt (Get-NextRetryAt) `
        -CurrentList $script:CurrentListState `
        -DetailPhaseStatus "not-started" `
        -DetailPendingCount 0 `
        -CachedListResume $script:CachedListResumeState
      Send-MobileReport
      Write-DailyLog "DAILY TASK FAILED: $currentListFailureReason"
      Write-DailyLog "safe bootstrap/current-list failure: production apply was not reached"
      exit $currentListExit
    }

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
        -ProductionWritten $false `
        -AppliedCount 0 `
        -CandidateCount 0 `
        -WouldApplyCount 0 `
        -IsolatedCandidateCount 0 `
        -FailureReason "current-list cache not reusable after fetch: $($currentListCache.reason)" `
        -FailureType "current-list" `
        -RetryAllowed $true `
        -NextRetryRecommendedAt (Get-NextRetryAt) `
        -CurrentList $script:CurrentListState `
        -DetailPhaseStatus "not-started" `
        -DetailPendingCount 0
      Send-MobileReport
      Write-DailyLog "DAILY TASK FAILED: current-list cache not reusable after fetch: $($currentListCache.reason)"
      Write-DailyLog "safe bootstrap/current-list failure: production apply was not reached"
      exit 1
    }
  }

  if (-not (Test-InventoryLocksBeforeStage -StageName "progressive-ingest-list")) {
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

  $detailQueueGuardExit = Invoke-InventoryNode -StepName "detail-queue-spike-guard" -Arguments @(
    "scripts/inventory/smokingpipes-detail-queue-spike-v1.mjs",
    "--previous-detail-pending-count=$previousDetailPendingCount"
  ) -ContinueOnFailure
  $detailQueueGuard = $script:LastInventoryNodeResult
  $detailQueueGuardFailed = (
    $detailQueueGuardExit -ne 0 -or
    -not $detailQueueGuard
  )
  $detailQueueGuardBlocked = (
    $detailQueueGuardFailed -or
    $detailQueueGuard.blocked -eq $true
  )

  if ($detailQueueGuardBlocked) {
    if (-not $detailQueueGuard) {
      $detailQueueGuard = [ordered]@{
        status = "manual-review-required"
        blocked = $true
        failureType = "detail-queue-spike"
        retryAllowed = $false
        detailPendingCount = 0
        previousDetailPendingCount = $previousDetailPendingCount
        blockReasons = @(
          "detail queue spike guard could not produce a valid diagnosis"
        )
        productionWritten = $false
      }
    }
    $detailPendingCount = [int]($detailQueueGuard.detailPendingCount)
    $detailQueueGuard | Add-Member -NotePropertyName "measurementPhase" -NotePropertyValue "pre-detail-chunk" -Force
    $detailQueueGuard | Add-Member -NotePropertyName "preChunkPendingDetailCount" -NotePropertyValue $detailPendingCount -Force
    $script:DetailPendingCount = $detailPendingCount
    $script:DetailQueueSpikeState = $detailQueueGuard
    $detailQueueBlockReasons = @($detailQueueGuard.blockReasons) -join "; "
    if (-not $detailQueueBlockReasons) {
      $detailQueueBlockReasons = "detail queue spike guard failed or blocked"
    }
    Write-DailyLog "detail queue spike guard blocked: pending=$detailPendingCount reasons=$detailQueueBlockReasons"
    Write-DailyTaskState `
      -Status "manual-review-required" `
      -Attempts $attempts `
      -CandidateCount (Get-AuditCandidateCount) `
      -FailureReason "Detail queue anomaly requires manual review: $detailQueueBlockReasons" `
      -FailureType "detail-queue-spike" `
      -RetryAllowed $false `
      -DetailPendingCount $detailPendingCount `
      -DetailQueueSpike $detailQueueGuard `
      -CachedListResume $script:CachedListResumeState
    Send-MobileReport
    Write-DailyLog "DETAIL queue spike blocked; detail fetch, production write, and automatic retry skipped"
    Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
    exit 0
  }

  $script:DetailPendingCount = [int]($detailQueueGuard.detailPendingCount)
  $detailQueueGuard | Add-Member -NotePropertyName "measurementPhase" -NotePropertyValue "pre-detail-chunk" -Force
  $detailQueueGuard | Add-Member -NotePropertyName "preChunkPendingDetailCount" -NotePropertyValue $script:DetailPendingCount -Force
  $script:DetailQueueSpikeState = $detailQueueGuard
  Write-DailyLog "detail queue spike guard passed: pending=$($detailQueueGuard.detailPendingCount)"

  if (-not (Test-InventoryLocksBeforeStage -StageName "progressive-detail-chunk")) {
    Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
    exit 0
  }

  if ($script:ResumeFromCachedListEffective -eq $true) {
    Write-DailyLog "START detail from cached-list resume"
  }
  Write-DailyLog "START detail chunk: max=$ProgressiveDetailMax pending=$($script:DetailPendingCount)"

  $detailExit = Invoke-InventoryNode -StepName "progressive-detail-chunk" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=progressive-detail-chunk",
    "--progressive-detail-max=$ProgressiveDetailMax",
    "--browser-channel=chrome",
    "--browser-profile=sp-chrome",
    "--allow-manual-verification=true",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  ) -ContinueOnFailure

  $detailResult = $script:LastInventoryNodeResult
  $detailStatus = if ($detailResult -and $detailResult.status) {
    [string]$detailResult.status
  } else {
    ""
  }
  $script:DetailPhaseStatus = $detailStatus
  $script:DetailCompletedThisRun = if (
    $detailResult -and $null -ne $detailResult.completedThisRun
  ) {
    [int]$detailResult.completedThisRun
  } else {
    0
  }

  if (-not (Test-DetailPhaseCanContinue -ExitCode $detailExit -Status $detailStatus)) {
    $detailBlockedReason = if ($detailResult -and $detailResult.blockedReason) {
      [string]$detailResult.blockedReason
    } else {
      $null
    }
    $failureReason = if ($detailExit -ne 0) {
      "progressive-detail-chunk failed before production write with exit code $detailExit"
    } elseif ($detailBlockedReason) {
      "progressive-detail-chunk blocked before production write: $detailBlockedReason"
    } else {
      "progressive-detail-chunk returned unsafe status '$detailStatus' before production write"
    }
    $failureType = Get-FailureType -Message $failureReason
    Write-DailyLog "detail chunk blocked or failed; production write skipped"
    Write-DailyTaskState `
      -Status "retryable-failed" `
      -Attempts $attempts `
      -CandidateCount (Get-AuditCandidateCount) `
      -FailureReason $failureReason `
      -FailureType $failureType `
      -RetryAllowed $true `
      -NextRetryRecommendedAt (Get-NextRetryAt) `
      -DetailPhaseStatus $detailStatus `
      -CachedListResume $script:CachedListResumeState
    Send-MobileReport
    exit $(if ($detailExit -ne 0) { $detailExit } else { 1 })
  }

  if ($detailStatus -eq "no-eligible-candidates") {
    Write-DailyLog "DETAIL chunk complete: no eligible candidates remain"
  } else {
    Write-DailyLog "DETAIL chunk complete: status=$detailStatus"
  }

  $detailPendingRemaining = if (
    $detailResult -and $null -ne $detailResult.remainingPendingCount
  ) {
    [int]$detailResult.remainingPendingCount
  } else {
    [int]$script:DetailPendingCount
  }
  $script:DetailPendingCount = $detailPendingRemaining

  if ($detailPendingRemaining -gt 0) {
    $script:DetailPhaseStatus = "detail-progress"
    $script:ResumeFromCachedListEffective = $true
    $script:LockCurrentListSnapshotUntilCompleteEffective = $true
    if ($currentListCache -and $currentListCache.usable -eq $true) {
      Set-CachedListResumeFromCache -Cache $currentListCache -Completed $false
    }
    Write-DailyLog "DETAIL progress: completed=$($script:DetailCompletedThisRun) remaining=$detailPendingRemaining; prepare/apply deferred and current-list snapshot locked"
    Write-DailyTaskState `
      -Status "detail-progress" `
      -Attempts $attempts `
      -ProductionWritten $false `
      -AppliedCount 0 `
      -CandidateCount (Get-AuditCandidateCount) `
      -WouldApplyCount 0 `
      -IsolatedCandidateCount 0 `
      -RetryAllowed $true `
      -NextRetryRecommendedAt (Get-NextRetryAt) `
      -CurrentList $script:CurrentListState `
      -DetailPhaseStatus $script:DetailPhaseStatus `
      -DetailPendingCount $detailPendingRemaining `
      -DetailPending $detailPendingRemaining `
      -DetailCompletedThisRun $script:DetailCompletedThisRun `
      -CachedListResume $script:CachedListResumeState
    Send-MobileReport
    Write-DailyLog "DAILY TASK DETAIL PROGRESS: production write and auto apply gate deferred until pending details reach zero"
    exit 0
  }

  Write-DailyLog "CONTINUE candidate/apply transition"
  Write-DailyTaskState `
    -Status "running" `
    -Attempts $attempts `
    -CandidateCount (Get-AuditCandidateCount) `
    -RetryAllowed $true `
    -DetailPhaseStatus $detailStatus `
    -DetailPendingCount $detailPendingRemaining `
    -DetailPending $detailPendingRemaining `
    -DetailCompletedThisRun $script:DetailCompletedThisRun `
    -CachedListResume $script:CachedListResumeState

  if (-not (Test-InventoryLocksBeforeStage -StageName "progressive-prepare-apply")) {
    Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
    exit 0
  }

  Clear-StaleProgressiveApplyReports -Reason "before prepare-apply"

  $prepareExit = Invoke-InventoryNode -StepName "progressive-prepare-apply" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=progressive-prepare-apply",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  ) -ContinueOnFailure

  $prepareResult = $script:LastInventoryNodeResult
  $prepareStatus = if ($prepareResult -and $prepareResult.status) {
    [string]$prepareResult.status
  } else {
    ""
  }
  $prepareApplyReady =
    $prepareExit -eq 0 -and
    $prepareResult -and
    $prepareResult.applyReady -eq $true
  $prepareCandidateCount = if ($prepareResult -and $prepareResult.candidateCount) {
    [int]$prepareResult.candidateCount
  } else {
    0
  }
  $prepareWouldApplyCount = if ($prepareResult -and $prepareResult.wouldApplyCount) {
    [int]$prepareResult.wouldApplyCount
  } else {
    0
  }
  $prepareIsolatedCandidateCount = if ($prepareResult -and $prepareResult.isolatedCandidateCount) {
    [int]$prepareResult.isolatedCandidateCount
  } else {
    0
  }

  if ($prepareApplyReady) {
    Write-DailyLog "progressive prepare apply gate ready candidateCount=$prepareCandidateCount wouldApplyCount=$prepareWouldApplyCount isolatedCandidateCount=$prepareIsolatedCandidateCount"
    if ($script:NoProductionWriteEffective -eq $true) {
      Write-DailyLog "safe bootstrap mode: production write skipped"
      Write-DailyTaskState `
        -Status "safe-bootstrap-complete" `
        -Attempts $attempts `
        -ProductionWritten $false `
        -AppliedCount 0 `
        -CandidateCount $prepareCandidateCount `
        -WouldApplyCount $prepareWouldApplyCount `
        -IsolatedCandidateCount $prepareIsolatedCandidateCount `
        -FailureReason "安全首跑完成：已生成候选、audit、preview 和 gate report，未写 production，等待人工确认。" `
        -FailureType "safe-bootstrap" `
        -RetryAllowed $false `
        -DetailPhaseStatus $script:DetailPhaseStatus `
        -CachedListResume $script:CachedListResumeState
      Send-MobileReport
      Write-DailyLog "DAILY TASK SAFE BOOTSTRAP COMPLETE"
      exit 0
    }

    if (-not (Test-InventoryLocksBeforeStage -StageName "progressive-partial-apply")) {
      Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
      exit 0
    }

    $applyExit = Invoke-InventoryNode -StepName "progressive-partial-apply" -Arguments @(
      "scripts/inventory/run-inventory-automation-v1.mjs",
      "--source=smokingpipes",
      "--mode=progressive-partial-apply",
      "--write-production",
      "--no-commit",
      "--no-deploy",
      "--verbose"
    ) -ContinueOnFailure
    $applyResult = $script:LastInventoryNodeResult
    $applyStatus = if ($applyResult -and $applyResult.status) {
      [string]$applyResult.status
    } else {
      ""
    }
    $applyProductionWritten =
      $applyResult -and $applyResult.productionWritten -eq $true
    $applyAppliedCount = if ($applyResult -and $applyResult.appliedCount) {
      [int]$applyResult.appliedCount
    } else {
      0
    }
    $applyIsolatedCandidateCount = if (
      $applyResult -and $applyResult.isolatedCandidateCount
    ) {
      [int]$applyResult.isolatedCandidateCount
    } else {
      0
    }
    if (
      $applyExit -ne 0 -or
      -not $applyProductionWritten -or
      $applyAppliedCount -le 0
    ) {
      $applyBlockedReason = if ($applyResult -and $applyResult.blockedReason) {
        [string]$applyResult.blockedReason
      } else {
        "status=$applyStatus productionWritten=$applyProductionWritten appliedCount=$applyAppliedCount"
      }
      $failureReason =
        "progressive-partial-apply blocked before confirmed production write: $applyBlockedReason"
      $failureType = if ($applyStatus -eq "apply-blocked") {
        "audit"
      } else {
        Get-FailureType -Message $failureReason
      }
      $retryAllowed = Test-FailureIsRetryable -FailureType $failureType
      Write-DailyTaskState `
        -Status $(if ($retryAllowed) { "retryable-failed" } else { "terminal-failed" }) `
        -Attempts $attempts `
        -CandidateCount $prepareCandidateCount `
        -IsolatedCandidateCount $applyIsolatedCandidateCount `
        -FailureReason $failureReason `
        -FailureType $failureType `
        -RetryAllowed $retryAllowed `
        -NextRetryRecommendedAt $(if ($retryAllowed) { Get-NextRetryAt } else { $null }) `
        -DetailPhaseStatus $script:DetailPhaseStatus `
        -CachedListResume $script:CachedListResumeState
      Send-MobileReport
      Write-DailyLog "production write was not confirmed; cached-list resume remains locked"
      exit $(if ($retryAllowed) { 1 } else { 0 })
    }
  } else {
    $prepareBlockedReason = if ($prepareResult -and $prepareResult.blockedReason) {
      [string]$prepareResult.blockedReason
    } elseif ($prepareResult -and $prepareResult.blockers) {
      (@($prepareResult.blockers) | ForEach-Object { [string]$_ }) -join "; "
    } else {
      "status=$prepareStatus applyReady=$prepareApplyReady"
    }
    $failureReason = "自动写入已阻断：$prepareBlockedReason"
    Write-DailyLog "progressive prepare apply gate blocked: $prepareBlockedReason"
    Write-DailyTaskState `
      -Status "safety-gate-blocked" `
      -Attempts $attempts `
      -CandidateCount $prepareCandidateCount `
      -IsolatedCandidateCount $prepareIsolatedCandidateCount `
      -FailureReason $failureReason `
      -FailureType "audit" `
      -RetryAllowed $false `
      -DetailPhaseStatus $script:DetailPhaseStatus `
      -CachedListResume $script:CachedListResumeState
    Send-MobileReport
    Write-DailyLog "DAILY TASK TERMINAL FAILED"
    exit 0
  }

  $candidateCount = $applyAppliedCount
  if ($script:ResumeFromCachedListEffective -eq $true) {
    Set-CachedListResumeFromCache -Cache $currentListCache -Completed $true
  }
  Write-DailyTaskState `
    -Status "success" `
    -Attempts $attempts `
    -ProductionWritten $true `
    -AppliedCount $candidateCount `
    -CandidateCount $candidateCount `
    -IsolatedCandidateCount $applyIsolatedCandidateCount `
    -RetryAllowed $false `
    -DetailPhaseStatus $script:DetailPhaseStatus `
    -CachedListResume $script:CachedListResumeState
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
