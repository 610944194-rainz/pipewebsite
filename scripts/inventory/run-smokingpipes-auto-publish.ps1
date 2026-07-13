param(
  [switch]$PreflightOnly,
  [switch]$NoProductionWrite,
  [switch]$NoPush,
  [switch]$ForceRunOnce,
  [switch]$SkipCurrentList,
  [switch]$AllowStaleCurrentListCache,
  [ValidatePattern('^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$')]
  [string]$ProgressiveDetailMax = "30",
  [ValidatePattern('^[1-9]\d*$')]
  [string]$MaxAutoApply = "1000",
  [string]$AutomationWorktree = "C:\Users\NING MEI\Desktop\pipewebsite-automation",
  [string]$NodeExecutable = "node",
  [string]$NotificationScriptPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ReportJsonPath = Join-Path $ProjectRoot "data\review\smokingpipes-auto-publish-latest.json"
$ReportMarkdownPath = Join-Path $ProjectRoot "data\review\smokingpipes-auto-publish-latest.md"
$DailyTaskStatePath = Join-Path $ProjectRoot "data\inventory\smokingpipes-daily-task-state.json"
$DailyScriptPath = Join-Path $ProjectRoot "scripts\inventory\run-smokingpipes-progressive-daily.ps1"
$ValidatorScriptPath = Join-Path $ProjectRoot "scripts\validate-public-product-indexes-v1.mjs"
$InventoryDefaultTestPath = Join-Path $ProjectRoot "scripts\test-public-products-inventory-default-v1.mjs"
$InventoryRunnerTestPath = Join-Path $ProjectRoot "scripts\inventory\test-inventory-runner-v1.mjs"
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

function Invoke-GitChecked {
  param([string[]]$Arguments)
  $output = @(& git -c http.sslBackend=openssl -C $ProjectRoot @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  return ($output -join [Environment]::NewLine).Trim()
}

function Invoke-CheckedCommand {
  param([string]$FilePath, [string[]]$Arguments, [string]$Stage)
  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "$Stage executable is missing: $FilePath"
  }
  $output = @(& $FilePath @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "$Stage failed with exit code ${LASTEXITCODE}: $($output -join [Environment]::NewLine)"
  }
  return ($output -join [Environment]::NewLine)
}

function Resolve-LocalExecutable {
  param([string]$Name, [string]$Stage)
  $command = Get-Command $Name -CommandType Application -ErrorAction Stop
  if (-not $command.Source) {
    throw "$Stage executable is missing: $Name"
  }
  return $command.Source
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
    "- commitPerformed: $($report.commitPerformed)",
    "- pushPerformed: $($report.pushPerformed)",
    "- deploymentStatus: $($report.deploymentStatus)",
    "- failureStage: $($report.failureStage)",
    "- failureReason: $($report.failureReason)"
  ) -join "`n"
  [IO.File]::WriteAllText($ReportMarkdownPath, "`uFEFF$markdown`n", [Text.UTF8Encoding]::new($true))
}

function Send-AutoPublishNotification {
  if (-not (Test-Path -LiteralPath $NotificationScriptPath -PathType Leaf)) {
    throw "notification helper is missing: $NotificationScriptPath"
  }
  Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($NotificationScriptPath, "--report=$ReportJsonPath") -Stage "notification-helper" | Out-Null
}

function Complete-AutoPublish {
  param([string]$Status, [string]$FailureStage = $null, [string]$FailureReason = $null)
  Write-AutoPublishReport -Status $Status -FailureStage $FailureStage -FailureReason $FailureReason
  try {
    Send-AutoPublishNotification
  } catch {
    $notificationFailure = $_.Exception.Message
    Write-AutoPublishReport -Status "notification-helper-failed" -FailureStage "notification-helper" -FailureReason $notificationFailure
    throw $notificationFailure
  }
}

function Stop-AutoPublish {
  param([string]$Status, [string]$Stage, [string]$Reason, [int]$ExitCode = 1)
  Write-AutoPublishReport -Status $Status -FailureStage $Stage -FailureReason $Reason
  Send-AutoPublishNotification
  throw $Reason
}

 $locationPushed = $false
try {
  Push-Location -LiteralPath $ProjectRoot
  $locationPushed = $true
  $NodeExecutablePath = Resolve-LocalExecutable -Name $NodeExecutable -Stage "node"
  $PowerShellExecutablePath = Resolve-LocalExecutable -Name "powershell.exe" -Stage "powershell"
  Test-AutomationWorktree
  Invoke-GitChecked -Arguments @("fetch", "origin") | Out-Null
  $report.startingMainSha = Invoke-GitChecked -Arguments @("rev-parse", "HEAD")
  $originMainSha = Invoke-GitChecked -Arguments @("rev-parse", "origin/main")
  $report.remoteMainShaBeforePush = $originMainSha
  if ($report.startingMainSha -ne $originMainSha) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "preflight" -Reason "HEAD does not match origin/main"
  }
  $branch = Invoke-GitChecked -Arguments @("branch", "--show-current")
  $upstream = Invoke-GitChecked -Arguments @("rev-parse", "--abbrev-ref", "@{u}")
  if ($branch -ne "main" -and -not ($branch -like "automation/*" -and $upstream -eq "origin/main")) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "preflight" -Reason "branch must be main or automation/* tracking origin/main"
  }
  if (@(& git -C $ProjectRoot status --porcelain --untracked-files=no).Count -gt 0) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "preflight" -Reason "automation worktree has tracked changes"
  }
  if (@(& git -C $ProjectRoot diff --cached --name-only).Count -gt 0) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "preflight" -Reason "automation worktree has staged files"
  }
  foreach ($lockPath in $LockPaths) {
    if (Test-Path -LiteralPath (Join-Path $ProjectRoot $lockPath)) {
      Stop-AutoPublish -Status "preflight-blocked" -Stage "lock" -Reason "active inventory lock: $lockPath"
    }
  }
  $otherInventoryProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -match "smokingpipes.*(?:inventory|progressive|daily)" -and $_.CommandLine -notmatch "run-smokingpipes-auto-publish"
  } | Select-Object -First 1
  if ($otherInventoryProcess) {
    Stop-AutoPublish -Status "preflight-blocked" -Stage "process" -Reason "another Smokingpipes inventory process is running"
  }
  if ($PreflightOnly) {
    $report.deploymentStatus = "not-requested"
    Complete-AutoPublish -Status "preflight-passed"
    exit 0
  }

  $dailyArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $DailyScriptPath)
  if ($NoProductionWrite) { $dailyArguments += "-NoProductionWrite" }
  if ($ForceRunOnce) { $dailyArguments += "-ForceRunOnce" }
  if ($SkipCurrentList) { $dailyArguments += "-SkipCurrentList" }
  if ($AllowStaleCurrentListCache) { $dailyArguments += "-AllowStaleCurrentListCache" }
  $dailyArguments += @("-ProgressiveDetailMax", $ProgressiveDetailMax)
  $dailyArguments += @("-MaxAutoApply", $MaxAutoApply)
  try {
    Invoke-CheckedCommand -FilePath $PowerShellExecutablePath -Arguments $dailyArguments -Stage "daily" | Out-Null
  } catch {
    Stop-AutoPublish -Status "daily-failed" -Stage "daily" -Reason $_.Exception.Message
  }
  if (-not (Test-Path -LiteralPath $DailyTaskStatePath)) {
    Stop-AutoPublish -Status "daily-failed" -Stage "daily" -Reason "daily task state is missing"
  }
  $dailyState = Get-Content -LiteralPath $DailyTaskStatePath -Raw -Encoding utf8 | ConvertFrom-Json
  $report.productionWritten = $dailyState.productionWritten -eq $true
  $report.candidateCount = Get-DailyNumber -State $dailyState -Name "candidateCount"
  $report.wouldApplyCount = Get-DailyNumber -State $dailyState -Name "wouldApplyCount"
  $report.appliedCount = Get-DailyNumber -State $dailyState -Name "appliedCount"
  $report.progressiveDetailMax = Get-DailyNumber -State $dailyState -Name "progressiveDetailMax"
  $dailyMaxAutoApply = Get-DailyNumber -State $dailyState -Name "maxAutoApply"
  if ($dailyMaxAutoApply -gt 0) { $report.maxAutoApply = $dailyMaxAutoApply }
  $dailyWarningThreshold = Get-DailyNumber -State $dailyState -Name "largeApplyWarningThreshold"
  if ($dailyWarningThreshold -gt 0) { $report.largeApplyWarningThreshold = $dailyWarningThreshold }
  $report.largeApplyWarning = if ($null -ne $dailyState.largeApplyWarning) {
    $dailyState.largeApplyWarning -eq $true
  } else {
    $report.wouldApplyCount -gt $report.largeApplyWarningThreshold
  }
  $report.largeApplyBlocked = if ($null -ne $dailyState.largeApplyBlocked) {
    $dailyState.largeApplyBlocked -eq $true
  } else {
    $report.wouldApplyCount -gt $report.maxAutoApply
  }
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

  Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($ValidatorScriptPath) -Stage "validator" | Out-Null
  $report.validatorPassed = $true
  Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($InventoryDefaultTestPath) -Stage "inventory-default-test" | Out-Null
  $report.inventoryDefaultPassed = $true
  Invoke-CheckedCommand -FilePath $NodeExecutablePath -Arguments @($InventoryRunnerTestPath) -Stage "inventory-runner-test" | Out-Null
  $report.inventoryRunnerPassed = $true
  Invoke-CheckedCommand -FilePath "npm.cmd" -Arguments @("run", "build") -Stage "build" | Out-Null
  $report.buildPassed = $true

  $changed = @(& git -C $ProjectRoot diff --name-only -- @ProductionExactPaths "data/generated/public-products") | Where-Object { $_ }
  $report.changedProductionFiles = @($changed)
  if ($changed.Count -eq 0) {
    $report.deploymentStatus = "not-requested"
    Complete-AutoPublish -Status "no-production-change"
    exit 0
  }
  foreach ($filePath in $changed) {
    if (-not (Test-AllowedProductionPath -PathToCheck $filePath)) {
      Stop-AutoPublish -Status "stage-blocked" -Stage "whitelist" -Reason "non-whitelisted production change: $filePath"
    }
    Invoke-GitChecked -Arguments @("add", "--", $filePath) | Out-Null
  }
  $stagedFiles = @(& git -C $ProjectRoot diff --cached --name-only) | Where-Object { $_ }
  $report.stagedFiles = @($stagedFiles)
  $nonWhitelisted = @($stagedFiles | Where-Object { -not (Test-AllowedProductionPath -PathToCheck $_) })
  if ($nonWhitelisted.Count -gt 0) {
    Invoke-GitChecked -Arguments @("reset") | Out-Null
    Stop-AutoPublish -Status "stage-blocked" -Stage "whitelist" -Reason "staged non-whitelisted files: $($nonWhitelisted -join ', ')"
  }
  if ($NoPush) {
    $report.deploymentStatus = "not-requested"
    Complete-AutoPublish -Status "validated-no-push"
    exit 0
  }
  Invoke-GitChecked -Arguments @("fetch", "origin") | Out-Null
  $remoteBeforePush = Invoke-GitChecked -Arguments @("rev-parse", "origin/main")
  if ($remoteBeforePush -ne $report.remoteMainShaBeforePush) {
    Invoke-GitChecked -Arguments @("reset") | Out-Null
    Stop-AutoPublish -Status "remote-main-changed" -Stage "push-preflight" -Reason "origin/main changed during run"
  }
  $commitMessage = "chore: refresh Smokingpipes inventory $(Get-Date -Format yyyy-MM-dd)"
  Invoke-GitChecked -Arguments @("commit", "-m", $commitMessage) | Out-Null
  $report.commitPerformed = $true
  $report.commitSha = Invoke-GitChecked -Arguments @("rev-parse", "HEAD")
  try {
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
  Complete-AutoPublish -Status "success"
} catch {
  if (-not $report.completedAt) {
    Write-AutoPublishReport -Status "failed" -FailureStage $(if ($report.failureStage) { $report.failureStage } else { "unexpected" }) -FailureReason $_.Exception.Message
    Send-AutoPublishNotification
  }
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($locationPushed) {
    Pop-Location -ErrorAction SilentlyContinue
  }
}
