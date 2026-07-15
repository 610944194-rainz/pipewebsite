param(
  [switch]$PreflightOnly,
  [switch]$NoProductionWrite,
  [switch]$NoPush,
  [switch]$ForceRunOnce,
  [switch]$SkipCurrentList,
  [switch]$AllowStaleCurrentListCache,
  [switch]$AllowDirtyWorktreeForManualVerification,
  [switch]$ResumeAfterProductionWrite,
  [ValidatePattern('^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$')]
  [string]$ProgressiveDetailMax = "30",
  [ValidatePattern('^[1-9]\d*$')]
  [string]$MaxAutoApply = "1000",
  [ValidateRange(1, 100000)]
  [int]$ExpectedAppliedCount = 895,
  [ValidateRange(0, 14400)]
  [int]$DailyTimeoutSeconds = 0,
  [string]$AutomationWorktree = "C:\Users\NING MEI\Desktop\pipewebsite-automation",
  [string]$NodeExecutable = "node",
  [string]$BuildExecutable = "npm.cmd",
  [string]$NotificationScriptPath = ""
)

$ErrorActionPreference = "Stop"
$CommandExecutionModulePath = Join-Path $PSScriptRoot "smokingpipes-command-execution-v1.psm1"
$DailyTaskLockHelperPath = Join-Path $PSScriptRoot "smokingpipes-daily-task-lock-v1.mjs"
Import-Module -Name $CommandExecutionModulePath -Force
$EffectiveBuildExecutable = if ([string]::IsNullOrWhiteSpace($BuildExecutable)) { "npm.cmd" } else { $BuildExecutable.Trim() }
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ReportJsonPath = Join-Path $ProjectRoot "data\review\smokingpipes-auto-publish-latest.json"
$ReportMarkdownPath = Join-Path $ProjectRoot "data\review\smokingpipes-auto-publish-latest.md"
$DailyTaskStatePath = Join-Path $ProjectRoot "data\inventory\smokingpipes-daily-task-state.json"
$ProgressiveStatePath = Join-Path $ProjectRoot "data\inventory\smokingpipes-progressive-daily-state.json"
$DailyScriptPath = Join-Path $ProjectRoot "scripts\inventory\run-smokingpipes-progressive-daily.ps1"
$ValidatorScriptPath = Join-Path $ProjectRoot "scripts\validate-public-product-indexes-v1.mjs"
$InventoryDefaultTestPath = Join-Path $ProjectRoot "scripts\test-public-products-inventory-default-v1.mjs"
$InventoryRunnerTestPath = Join-Path $ProjectRoot "scripts\inventory\test-inventory-runner-v1.mjs"
$PostApplyAuditScriptPath = Join-Path $ProjectRoot "scripts\inventory\smokingpipes-post-apply-recovery-audit-v1.mjs"
if (-not $NotificationScriptPath) {
  $NotificationScriptPath = Join-Path $ProjectRoot "scripts\inventory\smokingpipes-auto-publish-notify-v1.mjs"
}
$LockPaths = @(
  "data\inventory\smokingpipes-daily-task-lock.json",
  "data\inventory\state\smokingpipes.lock",
  "data\inventory\state\smokingpipes-progressive-daily.lock"
)
$ProductionExactPaths = @(
  "data/products/smokingpipes-products.json",
  "data/products/unified-products-staging.json"
)
$LargeApplyWarningThreshold = 300

function Format-GitCommand {
  param([string]$GitPath, [string[]]$Arguments)
  $displayArguments = @($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
  })
  return (@($GitPath) + $displayArguments) -join ' '
}

function Set-GitReportDiagnostics {
  param([string]$Command, [object]$Result)
  $report.gitCommand = $Command
  $report.gitExitCode = $Result.ExitCode
  $report.gitStdoutTail = Get-SmokingpipesTextTail -Text ([string]$Result.StdoutTail)
  $report.gitStderrTail = Get-SmokingpipesTextTail -Text ([string]$Result.StderrTail)
}

function Invoke-GitCommand {
  param(
    [string[]]$Arguments,
    [int[]]$AllowedExitCodes = @(0)
  )
  $git = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $effectiveArguments = @("-c", "http.sslBackend=openssl", "-C", $ProjectRoot) + $Arguments
  $command = Format-GitCommand -GitPath $git -Arguments $effectiveArguments
  try {
    $result = Invoke-SmokingpipesCommand -Stage "git" -FilePath $git -Arguments $effectiveArguments -WorkingDirectory $ProjectRoot -TimeoutSeconds 300
  } catch {
    $exitCode = $null
    if ($null -ne $_.Exception.Data["exitCode"]) { $exitCode = [int]$_.Exception.Data["exitCode"] }
    elseif ($_.Exception.Message -match 'exit code\s+(\d+)') { $exitCode = [int]$Matches[1] }
    $result = [pscustomobject]@{
      ExitCode = $exitCode
      StdoutTail = [string]$_.Exception.Data["stdoutTail"]
      StderrTail = [string]$_.Exception.Data["stderrTail"]
    }
  }
  Set-GitReportDiagnostics -Command $command -Result $result
  if ($AllowedExitCodes -notcontains $result.ExitCode) {
    $stderr = Get-SmokingpipesTextTail -Text ([string]$result.StderrTail)
    $reason = "git command failed: $command; exitCode=$($result.ExitCode)"
    if (-not [string]::IsNullOrWhiteSpace($stderr)) { $reason += "; stderr=$stderr" }
    $failure = [InvalidOperationException]::new($reason)
    $failure.Data["gitCommand"] = $command
    $failure.Data["gitExitCode"] = $result.ExitCode
    $failure.Data["gitStdoutTail"] = [string]$result.StdoutTail
    $failure.Data["gitStderrTail"] = [string]$result.StderrTail
    throw $failure
  }
  return $result
}

function Invoke-GitChecked {
  param([string[]]$Arguments)
  return (Invoke-GitCommand -Arguments $Arguments).StdoutTail.Trim()
}

function Resolve-DailyTimeoutSeconds {
  param([int]$RequestedSeconds)
  $candidate = if ($RequestedSeconds -gt 0) { $RequestedSeconds } elseif ($env:SMOKINGPIPES_DAILY_TIMEOUT_SECONDS) { [int]$env:SMOKINGPIPES_DAILY_TIMEOUT_SECONDS } else { 3600 }
  if ($candidate -lt 900 -or $candidate -gt 14400) { throw "SMOKINGPIPES_DAILY_TIMEOUT_SECONDS must be an integer from 900 to 14400" }
  return $candidate
}

function Invoke-CheckedCommand {
  param([string]$FilePath, [string[]]$Arguments, [string]$Stage, [int]$TimeoutSeconds = 0)
  $timeout = if ($TimeoutSeconds -gt 0) { $TimeoutSeconds } elseif ($Stage -match "build|inventory-runner") { 1200 } else { 600 }
  return (Invoke-SmokingpipesCommand -Stage $Stage -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $ProjectRoot -TimeoutSeconds $timeout)
}

function Resolve-LocalExecutable {
  param([string]$Name, [string]$Stage)
  $command = Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
  if (-not $command.Source) {
    throw "$Stage executable is missing: $Name"
  }
  return $command.Source
}

function Resolve-BuildExecutable {
  param(
    [string]$Requested,
    [string]$ProgramFilesPath = $env:ProgramFiles
  )

  if ([string]::IsNullOrWhiteSpace($Requested)) {
    throw "build executable request is not initialized"
  }

  if ([IO.Path]::IsPathRooted($Requested)) {
    if (Test-Path -LiteralPath $Requested -PathType Leaf) {
      return [pscustomobject]@{
        requested = $Requested
        resolved = (Resolve-Path -LiteralPath $Requested).Path
        resolutionMode = "explicit-path"
      }
    }
    throw "build executable is missing: $Requested"
  }

  try {
    $command = Get-Command -Name $Requested -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $resolved = if ($command.Source) { $command.Source } else { $command.Path }
    if ($resolved -and (Test-Path -LiteralPath $resolved -PathType Leaf)) {
      return [pscustomobject]@{
        requested = $Requested
        resolved = (Resolve-Path -LiteralPath $resolved).Path
        resolutionMode = "get-command"
      }
    }
  } catch {
    # Fall through to the well-known Node.js location below.
  }

  if ($Requested -ieq "npm.cmd") {
    $candidates = @()
    if ($ProgramFilesPath) {
      $candidates += (Join-Path $ProgramFilesPath "nodejs\npm.cmd")
    }
    $candidates += "C:\Program Files\nodejs\npm.cmd"
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return [pscustomobject]@{
          requested = $Requested
          resolved = (Resolve-Path -LiteralPath $candidate).Path
          resolutionMode = "program-files-fallback"
        }
      }
    }
  }
  throw "build executable is missing: $Requested"
}

function Test-AutomationWorktree {
  $expected = [IO.Path]::GetFullPath($AutomationWorktree).TrimEnd("\\")
  $actual = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\\")
  if ($actual -ne $expected) {
    throw "auto publish must run from the dedicated automation worktree"
  }
}

function Test-AllowedProductionPath {
  param([string]$PathToCheck)
  $normalized = $PathToCheck.Replace("\\", "/")
  return (
    $normalized -eq "data/products/smokingpipes-products.json" -or
    $normalized -eq "data/products/unified-products-staging.json" -or
    $normalized.StartsWith("data/generated/public-products/")
  )
}

function Get-DailyNumber {
  param([object]$State, [string]$Name)
  if ($State -and $null -ne $State.$Name) { return [int]$State.$Name }
  return 0
}

function Read-RequiredJson {
  param([string]$PathToRead, [string]$Description)
  if (-not (Test-Path -LiteralPath $PathToRead -PathType Leaf)) {
    throw "$Description is missing: $PathToRead"
  }
  return (Get-Content -LiteralPath $PathToRead -Raw -Encoding utf8 | ConvertFrom-Json)
}

function Test-PostApplyRecoveryRequiredPaths {
  $requiredPaths = @(
    [pscustomobject]@{ Description = "auto-publish report"; Path = $ReportJsonPath },
    [pscustomobject]@{ Description = "daily task state"; Path = $DailyTaskStatePath },
    [pscustomobject]@{ Description = "progressive daily state"; Path = $ProgressiveStatePath },
    [pscustomobject]@{ Description = "post-apply production audit"; Path = $PostApplyAuditScriptPath }
  )
  foreach ($required in $requiredPaths) {
    if ([string]::IsNullOrWhiteSpace([string]$required.Path)) {
      if ($required.Description -eq "daily task state") {
        throw "daily task state path is not initialized"
      }
      throw "$($required.Description) path is not initialized"
    }
    if (-not (Test-Path -LiteralPath $required.Path -PathType Leaf)) {
      throw "$($required.Description) is missing: $($required.Path)"
    }
  }
}

function Copy-DailyStateToReport {
  param([object]$State)
  $report.productionWritten = $State.productionWritten -eq $true
  $report.candidateCount = Get-DailyNumber -State $State -Name "candidateCount"
  $report.wouldApplyCount = Get-DailyNumber -State $State -Name "wouldApplyCount"
  $report.appliedCount = Get-DailyNumber -State $State -Name "appliedCount"
  $report.progressiveDetailMax = Get-DailyNumber -State $State -Name "progressiveDetailMax"
  $dailyMaxAutoApply = Get-DailyNumber -State $State -Name "maxAutoApply"
  if ($dailyMaxAutoApply -gt 0) { $report.maxAutoApply = $dailyMaxAutoApply }
  $dailyWarningThreshold = Get-DailyNumber -State $State -Name "largeApplyWarningThreshold"
  if ($dailyWarningThreshold -gt 0) { $report.largeApplyWarningThreshold = $dailyWarningThreshold }
  $report.largeApplyWarning = if ($null -ne $State.largeApplyWarning) {
    $State.largeApplyWarning -eq $true
  } else {
    $report.wouldApplyCount -gt $report.largeApplyWarningThreshold
  }
  $report.largeApplyBlocked = if ($null -ne $State.largeApplyBlocked) {
    $State.largeApplyBlocked -eq $true
  } else {
    $report.wouldApplyCount -gt $report.maxAutoApply
  }
}

function Get-PostApplyRecoveryReadiness {
  param([string]$HeadSha, [string]$OriginMainSha, [string]$Branch, [string]$Upstream)

  Test-PostApplyRecoveryRequiredPaths
  $previousReport = Read-RequiredJson -PathToRead $ReportJsonPath -Description "auto-publish report"
  $dailyState = Read-RequiredJson -PathToRead $DailyTaskStatePath -Description "daily task state"
  $progressiveState = Read-RequiredJson -PathToRead $ProgressiveStatePath -Description "progressive daily state"
  $candidates = @($progressiveState.candidates)
  $pendingCount = @($candidates | Where-Object { $_.detailStatus -eq "pending" }).Count
  $failedCount = @($candidates | Where-Object { $_.detailStatus -eq "failed" }).Count
  $dirtyFiles = @(& git -C $ProjectRoot diff --name-only) | Where-Object { $_ }
  $stagedFiles = @(& git -C $ProjectRoot diff --cached --name-only) | Where-Object { $_ }
  $blockers = @()
  if ($previousReport.productionWritten -ne $true) { $blockers += "report productionWritten must be true" }
  if ($previousReport.commitPerformed -eq $true) { $blockers += "report commitPerformed must be false" }
  if ($previousReport.pushPerformed -eq $true) { $blockers += "report pushPerformed must be false" }
  if ($dailyState.productionWritten -ne $true) { $blockers += "task productionWritten must be true" }
  if (-not ([int]$previousReport.appliedCount -gt 0)) { $blockers += "report appliedCount must be greater than 0" }
  if ([int]$previousReport.appliedCount -ne [int]$dailyState.appliedCount) { $blockers += "task appliedCount does not match report" }
  if ([int]$previousReport.wouldApplyCount -ne [int]$dailyState.wouldApplyCount) { $blockers += "task wouldApplyCount does not match report" }
  if ($pendingCount -gt 0) { $blockers += "pending candidates=$pendingCount" }
  if ($failedCount -gt 0) { $blockers += "failed candidates=$failedCount" }
  if ($progressiveState.fullExpectedRangeScanned -ne $true) { $blockers += "list fullExpectedRangeScanned must be true" }
  if ($HeadSha -ne $OriginMainSha) { $blockers += "HEAD does not match origin/main" }
  if ($Branch -notlike "automation/*") { $blockers += "branch must match automation/* for post-apply recovery" }
  if ($Upstream -ne "origin/main") { $blockers += "upstream must be origin/main for post-apply recovery" }
  if ($dirtyFiles.Count -eq 0) { $blockers += "production dirty files are required for post-apply recovery" }
  $disallowed = @($dirtyFiles | Where-Object { -not (Test-AllowedProductionPath -PathToCheck $_) })
  if ($disallowed.Count -gt 0) { $blockers += "non-production tracked changes: $($disallowed -join ', ')" }
  if ($stagedFiles.Count -gt 0) { $blockers += "post-apply recovery requires no pre-staged files" }
  return [pscustomobject]@{
    Allowed = $blockers.Count -eq 0
    Blockers = $blockers
    PreviousReport = $previousReport
    DailyState = $dailyState
    ProgressiveState = $progressiveState
    PendingCount = $pendingCount
    FailedCount = $failedCount
    DirtyFiles = $dirtyFiles
  }
}

$report = [ordered]@{
  runId = "smokingpipes-auto-publish-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  startedAt = (Get-Date).ToString("o")
  completedAt = $null
  startingMainSha = $null
  endingMainSha = $null
  remoteMainShaBeforePush = $null
  productionWritten = $false
  candidateCount = 0
  wouldApplyCount = 0
  appliedCount = 0
  progressiveDetailMax = [int]$ProgressiveDetailMax
  maxAutoApply = [int]$MaxAutoApply
  largeApplyWarningThreshold = $LargeApplyWarningThreshold
  largeApplyWarning = $false
  largeApplyBlocked = $false
  validatorPassed = $false
  inventoryDefaultPassed = $false
  inventoryRunnerPassed = $false
  buildPassed = $false
  buildExecutableRequested = $EffectiveBuildExecutable
  buildExecutableResolved = $null
  buildExecutableResolutionMode = $null
  syncAttempted = $false
  syncPerformed = $false
  headBeforeSync = $null
  headAfterSync = $null
  originMainSha = $null
  gitCommand = $null
  gitExitCode = $null
  gitStdoutTail = $null
  gitStderrTail = $null
  schedulerUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  workingDirectory = $ProjectRoot
  notificationStatus = "not-attempted"
  notificationFailure = $null
  resumeAfterProductionWrite = $ResumeAfterProductionWrite -eq $true
  recoverySourceRunId = $null
  recoveryPreflightPassed = $false
  postApplyAuditPassed = $false
  changedProductionFiles = @()
  stagedFiles = @()
  commitPerformed = $false
  commitSha = $null
  pushPerformed = $false
  pushTarget = "origin HEAD:main"
  deploymentMode = if ($env:YANDOUBUY_DEPLOY_HOOK_URL) { "deploy-hook" } else { "git-integration" }
  deploymentStatus = "not-started"
  status = "running"
  failureStage = $null
  failureReason = $null
}

function Write-AutoPublishReport {
  param([string]$Status, [string]$FailureStage = $null, [string]$FailureReason = $null)
  $report.status = $Status
  $report.failureStage = $FailureStage
  $report.failureReason = $FailureReason
  $report.completedAt = (Get-Date).ToString("o")
  New-Item -ItemType Directory -Force -Path (Split-Path $ReportJsonPath) | Out-Null
  $json = $report | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($ReportJsonPath, "$json`n", [Text.UTF8Encoding]::new($false))
  $markdown = @(
    "# Smokingpipes Auto Publish V1",
    "",
    "- status: $($report.status)",
    "- productionWritten: $($report.productionWritten)",
    "- candidateCount: $($report.candidateCount)",
    "- wouldApplyCount: $($report.wouldApplyCount)",
    "- appliedCount: $($report.appliedCount)",
    "- progressiveDetailMax: $($report.progressiveDetailMax)",
    "- maxAutoApply: $($report.maxAutoApply)",
    "- largeApplyWarningThreshold: $($report.largeApplyWarningThreshold)",
    "- largeApplyWarning: $($report.largeApplyWarning)",
    "- largeApplyBlocked: $($report.largeApplyBlocked)",
    "- resumeAfterProductionWrite: $($report.resumeAfterProductionWrite)",
    "- recoverySourceRunId: $($report.recoverySourceRunId)",
    "- recoveryPreflightPassed: $($report.recoveryPreflightPassed)",
    "- postApplyAuditPassed: $($report.postApplyAuditPassed)",
    "- buildExecutableRequested: $($report.buildExecutableRequested)",
    "- buildExecutableResolved: $($report.buildExecutableResolved)",
    "- buildExecutableResolutionMode: $($report.buildExecutableResolutionMode)",
    "- syncAttempted: $($report.syncAttempted)",
    "- syncPerformed: $($report.syncPerformed)",
    "- headBeforeSync: $($report.headBeforeSync)",
    "- headAfterSync: $($report.headAfterSync)",
    "- originMainSha: $($report.originMainSha)",
    "- gitCommand: $($report.gitCommand)",
    "- gitExitCode: $($report.gitExitCode)",
    "- gitStdoutTail: $($report.gitStdoutTail)",
    "- gitStderrTail: $($report.gitStderrTail)",
    "- schedulerUser: $($report.schedulerUser)",
    "- workingDirectory: $($report.workingDirectory)",
    "- notificationStatus: $($report.notificationStatus)",
    "- notificationFailure: $($report.notificationFailure)",
    "- commitPerformed: $($report.commitPerformed)",
    "- pushPerformed: $($report.pushPerformed)",
    "- deploymentStatus: $($report.deploymentStatus)",
    "- failureStage: $($report.failureStage)",
    "- failureReason: $($report.failureReason)"
  ) -join "`n"
  [IO.File]::WriteAllText($ReportMarkdownPath, "`uFEFF$markdown`n", [Text.UTF8Encoding]::new($true))
}

function Send-AutoPublishNotification {
  if ([string]::IsNullOrWhiteSpace($NotificationScriptPath)) {
    $report.notificationStatus = "skipped-not-configured"
    return
  }
  if (-not (Test-Path -LiteralPath $NotificationScriptPath -PathType Leaf)) {
    throw "notification helper is missing: $NotificationScriptPath"
  }
  Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($NotificationScriptPath, "--report=$ReportJsonPath") -Stage "notification-helper" | Out-Null
  $report.notificationStatus = "sent"
}

function Send-AutoPublishNotificationSafely {
  try {
    Send-AutoPublishNotification
  } catch {
    $report.notificationStatus = "failed"
    $report.notificationFailure = $_.Exception.Message
  }
}

function Complete-AutoPublish {
  param([string]$Status, [string]$FailureStage = $null, [string]$FailureReason = $null)
  Write-AutoPublishReport -Status $Status -FailureStage $FailureStage -FailureReason $FailureReason
  Send-AutoPublishNotificationSafely
  Write-AutoPublishReport -Status $Status -FailureStage $FailureStage -FailureReason $FailureReason
}

function Stop-AutoPublish {
  param([string]$Status, [string]$Stage, [string]$Reason, [int]$ExitCode = 1)
  Write-AutoPublishReport -Status $Status -FailureStage $Stage -FailureReason $Reason
  Send-AutoPublishNotificationSafely
  Write-AutoPublishReport -Status $Status -FailureStage $Stage -FailureReason $Reason
  throw $Reason
}

function Sync-AutomationRuntimeWithOriginMain {
  $report.syncAttempted = $true
  $report.failureStage = "sync"
  Invoke-GitChecked -Arguments @("fetch", "origin") | Out-Null
  $headBefore = Invoke-GitChecked -Arguments @("rev-parse", "HEAD")
  $originMain = Invoke-GitChecked -Arguments @("rev-parse", "origin/main")
  $branch = Invoke-GitChecked -Arguments @("branch", "--show-current")
  $upstream = Invoke-GitChecked -Arguments @("rev-parse", "--abbrev-ref", "@{u}")
  $dirtyFiles = @(Invoke-GitChecked -Arguments @("status", "--porcelain")) | Where-Object { $_ }
  $report.headBeforeSync = $headBefore
  $report.originMainSha = $originMain

  if ($dirtyFiles.Count -gt 0 -and -not $AllowDirtyWorktreeForManualVerification) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "sync" -Reason "automation worktree is dirty before sync"
  }
  if ($dirtyFiles.Count -gt 0 -and $AllowDirtyWorktreeForManualVerification -and -not $NoPush) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "sync" -Reason "dirty manual verification requires -NoPush"
  }
  if ($dirtyFiles.Count -gt 0 -and $AllowDirtyWorktreeForManualVerification) {
    Write-Host "[INFO] dirty worktree accepted for manual verification with -NoPush; automatic scheduler never sets this flag"
  }
  if ($branch -ne "automation/smokingpipes-production-run") {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "sync" -Reason "scheduled sync requires branch automation/smokingpipes-production-run; actual=$branch"
  }
  if ($upstream -ne "origin/main") {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "sync" -Reason "scheduled sync requires upstream origin/main; actual=$upstream"
  }

  if ($headBefore -ne $originMain) {
    $headIsAncestor = Invoke-GitCommand -Arguments @("merge-base", "--is-ancestor", "HEAD", "origin/main") -AllowedExitCodes @(0, 1)
    if ($headIsAncestor.ExitCode -eq 0) {
      Invoke-GitChecked -Arguments @("merge", "--ff-only", "origin/main") | Out-Null
      $report.syncPerformed = $true
    } else {
      $originIsAncestor = Invoke-GitCommand -Arguments @("merge-base", "--is-ancestor", "origin/main", "HEAD") -AllowedExitCodes @(0, 1)
      $reason = if ($originIsAncestor.ExitCode -eq 0) {
        "local branch is ahead of origin/main; automatic sync is not allowed"
      } else {
        "local branch diverged from origin/main; automatic sync is not allowed"
      }
      Stop-AutoPublish -Status "preflight-blocked" -Stage "sync" -Reason $reason
    }
  }

  $headAfter = Invoke-GitChecked -Arguments @("rev-parse", "HEAD")
  $originAfter = Invoke-GitChecked -Arguments @("rev-parse", "origin/main")
  $report.headAfterSync = $headAfter
  $report.originMainSha = $originAfter
  if ($headAfter -ne $originAfter) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "sync" -Reason "HEAD does not match origin/main after sync"
  }
  $report.failureStage = $null
  return [pscustomobject]@{ Head = $headAfter; OriginMain = $originAfter; Branch = $branch; Upstream = $upstream }
}

 $locationPushed = $false
try {
  Push-Location -LiteralPath $ProjectRoot
  $locationPushed = $true
  $NodeExecutablePath = Resolve-LocalExecutable -Name $NodeExecutable -Stage "node"
  $PowerShellExecutablePath = Resolve-LocalExecutable -Name "powershell.exe" -Stage "powershell"
  Test-AutomationWorktree
  if ($ResumeAfterProductionWrite) {
    $resumeScriptPath = Join-Path $ProjectRoot "scripts\inventory\resume-smokingpipes-post-apply-v1.ps1"
    if (-not (Test-Path -LiteralPath $resumeScriptPath -PathType Leaf)) { throw "dedicated post-apply recovery script is missing: $resumeScriptPath" }
    $resolvedBuild = Resolve-BuildExecutable -Requested $EffectiveBuildExecutable
    $resumeArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $resumeScriptPath, "-AutomationWorktree", $AutomationWorktree, "-BuildExecutable", $resolvedBuild.resolved, "-ExpectedAppliedCount", $ExpectedAppliedCount)
    if ($PreflightOnly) { $resumeArguments += "-PreflightOnly" }
    Write-Host "[START] post-apply-recovery delegation"
    & $PowerShellExecutablePath @resumeArguments
    $resumeExitCode = $LASTEXITCODE
    if ($resumeExitCode -ne 0) { throw "dedicated post-apply recovery failed with exit code $resumeExitCode" }
    Write-Host "[PASS] post-apply-recovery delegation buildExecutable=$($resolvedBuild.resolved)"
    exit 0
  }
  if (-not $ResumeAfterProductionWrite) {
    $sync = Sync-AutomationRuntimeWithOriginMain
    $report.startingMainSha = $sync.Head
    $originMainSha = $sync.OriginMain
    $branch = $sync.Branch
    $upstream = $sync.Upstream
  } else {
    Invoke-GitChecked -Arguments @("fetch", "origin") | Out-Null
    $report.startingMainSha = Invoke-GitChecked -Arguments @("rev-parse", "HEAD")
    $originMainSha = Invoke-GitChecked -Arguments @("rev-parse", "origin/main")
    $branch = Invoke-GitChecked -Arguments @("branch", "--show-current")
    $upstream = Invoke-GitChecked -Arguments @("rev-parse", "--abbrev-ref", "@{u}")
  }
  $report.remoteMainShaBeforePush = $originMainSha
  if ($ResumeAfterProductionWrite -and ($branch -notlike "automation/*" -or $upstream -ne "origin/main")) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "preflight" -Reason "post-apply recovery requires automation/* tracking origin/main"
  }
  foreach ($lockPath in $LockPaths) {
    $absoluteLockPath = Join-Path $ProjectRoot $lockPath
    if (-not (Test-Path -LiteralPath $absoluteLockPath)) { continue }
    if ($lockPath -eq "data\inventory\smokingpipes-daily-task-lock.json") {
      $archiveRoot = Join-Path $ProjectRoot "data\audits\smokingpipes-daily-fix\lock-archives"
      $recoveryOutput = & node $DailyTaskLockHelperPath recover "--path=$absoluteLockPath" "--root=$ProjectRoot" "--archive-dir=$archiveRoot" 2>&1
      if ($LASTEXITCODE -ne 0) { Stop-AutoPublish -Status "preflight-blocked" -Stage "lock" -Reason "daily task lock inspection failed: $recoveryOutput" }
      $recovery = ($recoveryOutput | Out-String | ConvertFrom-Json)
      if ($recovery.recovered -eq $true) { Write-Host "[INFO] stale daily task lock archived: $($recovery.archivePath)" }
    } else {
      $inventoryLockHelperPath = Join-Path $PSScriptRoot "smokingpipes-inventory-lock-v1.mjs"
      $inspectionOutput = & node $inventoryLockHelperPath 2>&1
      if ($LASTEXITCODE -ne 0) { Stop-AutoPublish -Status "preflight-blocked" -Stage "lock" -Reason "inventory lock inspection failed: $inspectionOutput" }
      $inspection = ($inspectionOutput | Out-String | ConvertFrom-Json)
      $matchingLock = @($inspection.locks | Where-Object { $_.path.Replace('/','\') -eq $lockPath }) | Select-Object -First 1
      if ($matchingLock -and $matchingLock.stale -eq $true) {
        $archiveRoot = Join-Path $ProjectRoot "data\audits\smokingpipes-daily-fix\lock-archives"
        New-Item -ItemType Directory -Force -Path $archiveRoot | Out-Null
        $archivePath = Join-Path $archiveRoot ((Split-Path $absoluteLockPath -Leaf) + "." + (Get-Date -Format "yyyyMMdd-HHmmss") + "." + $matchingLock.reason + ".json")
        Copy-Item -LiteralPath $absoluteLockPath -Destination $archivePath -Force
        $clearOutput = & node $inventoryLockHelperPath --clear-stale 2>&1
        if ($LASTEXITCODE -ne 0) { Stop-AutoPublish -Status "preflight-blocked" -Stage "lock" -Reason "inventory stale lock cleanup failed: $clearOutput" }
        Write-Host "[INFO] stale inventory lock archived: $archivePath"
      }
    }
    if (Test-Path -LiteralPath $absoluteLockPath) {
      Stop-AutoPublish -Status "preflight-blocked" -Stage "lock" -Reason "active inventory lock: $lockPath"
    }
  }
  $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $processById = @{}
  foreach ($process in $processSnapshot) { $processById[[int]$process.ProcessId] = $process }
  $ancestorProcessIds = [Collections.Generic.HashSet[int]]::new()
  $ancestorCursor = [int]$PID
  while ($processById.ContainsKey($ancestorCursor)) {
    $parentId = [int]$processById[$ancestorCursor].ParentProcessId
    if ($parentId -le 0 -or -not $ancestorProcessIds.Add($parentId)) { break }
    $ancestorCursor = $parentId
  }
  $otherInventoryProcess = $processSnapshot | Where-Object {
    $_.ProcessId -ne $PID -and -not $ancestorProcessIds.Contains([int]$_.ProcessId) -and $_.CommandLine -match "smokingpipes.*(?:inventory|progressive|daily)" -and $_.CommandLine -notmatch "run-smokingpipes-auto-publish"
  } | Select-Object -First 1
  if ($otherInventoryProcess) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "process" -Reason "another Smokingpipes inventory process is running"
  }
  $recoveryReadiness = $null
  if ($ResumeAfterProductionWrite) {
    $report.failureStage = "recovery-state-validation"
    $recoveryReadiness = Get-PostApplyRecoveryReadiness -HeadSha $report.startingMainSha -OriginMainSha $originMainSha -Branch $branch -Upstream $upstream
    if (-not $recoveryReadiness.Allowed) {
      Stop-AutoPublish -Status "preflight-blocked" -Stage "post-apply-recovery-preflight" -Reason ($recoveryReadiness.Blockers -join "; ")
    }
    $report.recoverySourceRunId = [string]$recoveryReadiness.PreviousReport.runId
    Copy-DailyStateToReport -State $recoveryReadiness.DailyState
    $report.commitPerformed = $false
    $report.pushPerformed = $false
    $report.recoveryPreflightPassed = $true
    $report.changedProductionFiles = @($recoveryReadiness.DirtyFiles)
    $report.failureStage = $null
  }
  if ($PreflightOnly) {
    $report.deploymentStatus = "not-requested"
    Complete-AutoPublish -Status $(if ($ResumeAfterProductionWrite) { "post-apply-recovery-preflight-passed" } else { "preflight-passed" })
    exit 0
  }

  if (-not $ResumeAfterProductionWrite) {
  $effectiveDailyTimeoutSeconds = Resolve-DailyTimeoutSeconds -RequestedSeconds $DailyTimeoutSeconds
  $dailyArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $DailyScriptPath)
  if ($NoProductionWrite) { $dailyArguments += "-NoProductionWrite" }
  if ($ForceRunOnce) { $dailyArguments += "-ForceRunOnce" }
  if ($SkipCurrentList) { $dailyArguments += "-SkipCurrentList" }
  if ($AllowStaleCurrentListCache) { $dailyArguments += "-AllowStaleCurrentListCache" }
  $dailyArguments += @("-ProgressiveDetailMax", $ProgressiveDetailMax)
  $dailyArguments += @("-MaxAutoApply", $MaxAutoApply)
  try {
    Invoke-CheckedCommand -FilePath $PowerShellExecutablePath -Arguments $dailyArguments -Stage "daily" -TimeoutSeconds $effectiveDailyTimeoutSeconds | Out-Null
  } catch {
    Stop-AutoPublish -Status "daily-failed" -Stage "daily" -Reason $_.Exception.Message
  }
  if (-not (Test-Path -LiteralPath $DailyTaskStatePath)) {
    Stop-AutoPublish -Status "daily-failed" -Stage "daily" -Reason "daily task state is missing"
  }
  $dailyState = Get-Content -LiteralPath $DailyTaskStatePath -Raw -Encoding utf8 | ConvertFrom-Json
  Copy-DailyStateToReport -State $dailyState
  if ($dailyState.status -in @("manual-review-required", "safety-gate-blocked", "terminal-failed", "retryable-failed")) {
    Stop-AutoPublish -Status "safety-gate-blocked" -Stage "daily" -Reason ([string]$dailyState.lastFailureReason)
  }
  if ($dailyState.status -eq "detail-progress") {
    $report.deploymentStatus = "not-requested"
    Complete-AutoPublish -Status "detail-progress"
    exit 0
  }
  if (-not $report.productionWritten) {
    $report.deploymentStatus = "not-requested"
    Complete-AutoPublish -Status "no-production-change"
    exit 0
  }
  }

  if ($ResumeAfterProductionWrite) {
    $report.failureStage = "diff-guard"
    Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($PostApplyAuditScriptPath, "--root=$ProjectRoot", "--expected-applied-count=$($report.appliedCount)") -Stage "post-apply-production-audit" | Out-Null
    $report.postApplyAuditPassed = $true
    $report.failureStage = $null
  }

  $report.failureStage = "validator"
  Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($ValidatorScriptPath) -Stage "validator" | Out-Null
  $report.validatorPassed = $true
  Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($InventoryDefaultTestPath) -Stage "inventory-default-test" | Out-Null
  $report.inventoryDefaultPassed = $true
  Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($InventoryRunnerTestPath) -Stage "inventory-runner-test" | Out-Null
  $report.inventoryRunnerPassed = $true
  $report.failureStage = "executable-resolution"
  $resolvedBuildExecutable = Resolve-BuildExecutable -Requested $EffectiveBuildExecutable
  $report.buildExecutableRequested = $resolvedBuildExecutable.requested
  $report.buildExecutableResolved = $resolvedBuildExecutable.resolved
  $report.buildExecutableResolutionMode = $resolvedBuildExecutable.resolutionMode
  $report.failureStage = "build"
  Invoke-CheckedCommand -FilePath $resolvedBuildExecutable.resolved -Arguments @("run", "build") -Stage "build" | Out-Null
  $report.buildPassed = $true

  $report.failureStage = "diff-guard"
  if ($ResumeAfterProductionWrite) {
    Invoke-GitChecked -Arguments @("diff", "--check") | Out-Null
    $changed = @(& git -C $ProjectRoot diff --name-only) | Where-Object { $_ }
  } else {
    $changed = @(& git -C $ProjectRoot diff --name-only -- @ProductionExactPaths "data/generated/public-products") | Where-Object { $_ }
  }
  $report.changedProductionFiles = @($changed)
  if ($changed.Count -eq 0) {
    $report.deploymentStatus = "not-requested"
    Complete-AutoPublish -Status "no-production-change"
    exit 0
  }
  foreach ($filePath in $changed) {
    $report.failureStage = "stage"
    if (-not (Test-AllowedProductionPath -PathToCheck $filePath)) {
      Stop-AutoPublish -Status "stage-blocked" -Stage "whitelist" -Reason "non-whitelisted production change: $filePath"
    }
    Invoke-GitChecked -Arguments @("add", "--", $filePath) | Out-Null
  }
  $stagedFiles = @(& git -C $ProjectRoot diff --cached --name-only) | Where-Object { $_ }
  $report.stagedFiles = @($stagedFiles)
  $nonWhitelisted = @($stagedFiles | Where-Object { -not (Test-AllowedProductionPath -PathToCheck $_) })
  if ($nonWhitelisted.Count -gt 0) {
    if (-not $ResumeAfterProductionWrite) {
      Invoke-GitChecked -Arguments @("reset") | Out-Null
    }
    Stop-AutoPublish -Status "stage-blocked" -Stage "whitelist" -Reason "staged non-whitelisted files: $($nonWhitelisted -join ', ')"
  }
  if ($NoPush) {
    $report.deploymentStatus = "not-requested"
    Complete-AutoPublish -Status "validated-no-push"
    exit 0
  }
  $report.failureStage = "push"
  Invoke-GitChecked -Arguments @("fetch", "origin") | Out-Null
  $remoteBeforePush = Invoke-GitChecked -Arguments @("rev-parse", "origin/main")
  if ($remoteBeforePush -ne $report.remoteMainShaBeforePush) {
    if (-not $ResumeAfterProductionWrite) {
      Invoke-GitChecked -Arguments @("reset") | Out-Null
    }
    Stop-AutoPublish -Status "remote-main-changed" -Stage "push-preflight" -Reason "origin/main changed during run"
  }
  $commitMessage = if ($ResumeAfterProductionWrite) {
    "chore: publish Smokingpipes daily update $(Get-Date -Format yyyyMMdd)"
  } else {
    "chore: refresh Smokingpipes inventory $(Get-Date -Format yyyy-MM-dd)"
  }
  $report.failureStage = "commit"
  Invoke-GitChecked -Arguments @("commit", "-m", $commitMessage) | Out-Null
  $report.commitPerformed = $true
  $report.commitSha = Invoke-GitChecked -Arguments @("rev-parse", "HEAD")
  try {
    $report.failureStage = "push"
    Invoke-GitChecked -Arguments @("push", "origin", "HEAD:main") | Out-Null
    $report.pushPerformed = $true
    $report.endingMainSha = $report.commitSha
  } catch {
    $report.deploymentStatus = "not-requested"
    Write-AutoPublishReport -Status "push-failed" -FailureStage "push" -FailureReason $_.Exception.Message
    Send-AutoPublishNotification
    throw
  }
  if ($env:YANDOUBUY_DEPLOY_HOOK_URL) {
    try {
      $response = Invoke-WebRequest -Uri $env:YANDOUBUY_DEPLOY_HOOK_URL -Method Post -UseBasicParsing -TimeoutSec 30
      $report.deploymentStatus = "deploy-hook-requested-http-$($response.StatusCode)"
    } catch {
      $report.deploymentStatus = "deploy-hook-failed"
      Write-AutoPublishReport -Status "push-complete-deploy-hook-failed" -FailureStage "deploy-hook" -FailureReason $_.Exception.Message
      Send-AutoPublishNotification
      exit 0
    }
  } else {
    $report.deploymentStatus = "push-complete-deployment-pending-verification"
  }
  $report.failureStage = $null
  Complete-AutoPublish -Status "success"
} catch {
  if (-not $report.completedAt) {
    Write-AutoPublishReport -Status "failed" -FailureStage $(if ($report.failureStage) { $report.failureStage } else { "unexpected" }) -FailureReason $_.Exception.Message
    Send-AutoPublishNotificationSafely
    Write-AutoPublishReport -Status "failed" -FailureStage $(if ($report.failureStage) { $report.failureStage } else { "unexpected" }) -FailureReason $_.Exception.Message
  }
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($locationPushed) {
    Pop-Location -ErrorAction SilentlyContinue
  }
}
