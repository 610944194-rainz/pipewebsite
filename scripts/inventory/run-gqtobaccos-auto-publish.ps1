param(
  [switch]$NoProductionWrite,
  [switch]$NoPush,
  [switch]$PreflightOnly,
  [switch]$ApplyProduction,
  [switch]$TestNotification,
  [string]$ApplyCandidatePath = "",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Runner = Join-Path $PSScriptRoot "run-gqtobaccos-daily-v1.mjs"
$PushDeerNotifier = Join-Path $PSScriptRoot "inventory-pushdeer-notifier-v1.mjs"
$PublicationPaths = @(
  "data/products/gqtobaccos-products.json",
  "data/products/unified-products-staging.json",
  "data/generated/public-products"
)
Import-Module (Join-Path $PSScriptRoot "../lib/production-publish-lock-v1.psm1") -Force
$script:ProductionPublishLock = $null
$script:PublicationCommitSha = ""
$script:PublicationStage = "apply"
$script:PublicationBaseHead = ""

function Invoke-Git {
  param(
    [string[]]$Arguments,
    [int[]]$AllowedExitCodes = @(0)
  )
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& git -C $RuntimeRoot @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -notin $AllowedExitCodes) {
    throw "git command failed: git -C '$RuntimeRoot' $($Arguments -join ' '); gitExitCode=$exitCode; stderr-tail=$($output | Select-Object -Last 20 | Out-String)"
  }
  return ($output | Out-String).Trim()
}

function Assert-TrackedRuntimeClean {
  $dirty = Invoke-Git -Arguments @("status", "--porcelain", "--untracked-files=no")
  if ($dirty) { throw "runtime tracked worktree is not clean: $dirty" }
}

function Release-GqProductionPublishLock {
  if ($script:ProductionPublishLock) {
    Release-ProductionPublishLock -Lock $script:ProductionPublishLock
    $script:ProductionPublishLock = $null
  }
}

function Invoke-GqNodeCommand {
  param([string[]]$Arguments)
  $node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& $node.Source @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
}

function Invoke-GqCandidateApply {
  param([Parameter(Mandatory = $true)][string]$CandidatePath)
  $result = Invoke-GqNodeCommand -Arguments @($Runner, "--apply-candidate=$CandidatePath")
  if ($result.ExitCode -ne 0) {
    throw "GQ Production candidate apply failed; $($result.Output | Select-Object -Last 40 | Out-String)"
  }
}

function Invoke-GqSuccessNotification {
  param([Parameter(Mandatory = $true)][string]$DailyReportPath)
  $result = Invoke-GqNodeCommand -Arguments @($Runner, "--notify-report=$DailyReportPath")
  if ($result.ExitCode -ne 0) {
    Write-Warning "GQ success PushDeer notification failed; $($result.Output | Select-Object -Last 20 | Out-String)"
  }
}

function Invoke-GitFetchWithRetry {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Invoke-Git -Arguments @("fetch", "origin") | Out-Null
      return
    } catch {
      if ($attempt -eq 3) { throw }

      $delaySeconds = if ($attempt -eq 1) { 10 } else { 30 }
      Write-Warning "git fetch origin failed (attempt $attempt/3); retrying in $delaySeconds seconds."
      Start-Sleep -Seconds $delaySeconds
    }
  }
}

function Invoke-GitPushWithRetry {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Invoke-Git -Arguments @("push", "origin", "HEAD") | Out-Null
      return
    } catch {
      if ($attempt -eq 3) { throw }

      $delaySeconds = if ($attempt -eq 1) { 10 } else { 30 }
      Write-Warning "git push origin HEAD failed (attempt $attempt/3); retrying in $delaySeconds seconds."
      Start-Sleep -Seconds $delaySeconds
    }
  }
}

function Test-GqPublicationPath {
  param([string]$Path)

  foreach ($publicationPath in $PublicationPaths) {
    if ($Path -eq $publicationPath -or $Path.StartsWith("$publicationPath/")) {
      return $true
    }
  }
  return $false
}

function Get-GqRetainedPublicationCommit {
  $dirty = Invoke-Git -Arguments @("status", "--porcelain", "--untracked-files=no")
  if ($dirty) { return $null }

  $branch = Invoke-Git -Arguments @("branch", "--show-current")
  if ($branch -ne "main") { return $null }

  $localOnlyCount = [int](Invoke-Git -Arguments @("rev-list", "--count", "origin/main..HEAD"))
  if ($localOnlyCount -ne 1) { return $null }

  $commit = Invoke-Git -Arguments @("rev-list", "--max-count=1", "origin/main..HEAD")
  $subject = Invoke-Git -Arguments @("log", "-1", "--format=%s", $commit)
  if ($subject -ne "chore(inventory): publish GQ Tobaccos daily update") { return $null }

  $changedPaths = @((Invoke-Git -Arguments @("diff-tree", "--no-commit-id", "--name-only", "-r", $commit)) -split "`r?`n" | Where-Object { $_ })
  if ($changedPaths.Count -eq 0) { return $null }
  if (@($changedPaths | Where-Object { -not (Test-GqPublicationPath -Path $_) }).Count -gt 0) { return $null }

  return $commit
}

function Sync-FormalMainRuntime {
  $branch = Invoke-Git -Arguments @("branch", "--show-current")
  if ($branch -ne "main") {
    throw "GQ scheduled runtime must run from the formal main worktree; actual branch=$branch"
  }

  Invoke-GitFetchWithRetry
  $head = Invoke-Git -Arguments @("rev-parse", "HEAD")
  $originMain = Invoke-Git -Arguments @("rev-parse", "origin/main")
  if ($head -eq $originMain) { return }

  $retainedCommit = Get-GqRetainedPublicationCommit
  if ($retainedCommit) {
    $retainedParent = Invoke-Git -Arguments @("rev-parse", "$retainedCommit^")
    if ($originMain -eq $retainedParent) {
      return "retained-commit-push-required"
    }

    & git -C $RuntimeRoot merge-base --is-ancestor $retainedParent origin/main 2>$null
    if ($LASTEXITCODE -eq 0) {
      Invoke-Git -Arguments @("reset", "--hard", "origin/main") | Out-Null
      Assert-TrackedRuntimeClean
      return "retained-commit-discarded"
    }
  }

  & git -C $RuntimeRoot merge-base --is-ancestor HEAD origin/main 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "formal main runtime is ahead of or diverged from origin/main; automatic GQ sync is blocked"
  }
  Invoke-Git -Arguments @("merge", "--ff-only", "origin/main") | Out-Null
  Assert-TrackedRuntimeClean
}

function Get-GqPublicationDirtyPaths {
  $outputs = @(
    (Invoke-Git -Arguments @("diff", "--name-only", "--")),
    (Invoke-Git -Arguments @("diff", "--cached", "--name-only", "--"))
  )
  $publicationDirtyPaths = @()
  foreach ($output in $outputs) {
    if (-not $output) { continue }
    foreach ($candidate in ($output -split "`r?`n")) {
      if (-not $candidate) { continue }
      foreach ($publicationPath in $PublicationPaths) {
        if ($candidate -eq $publicationPath -or $candidate.StartsWith("$publicationPath/")) {
          $publicationDirtyPaths += $candidate
          break
        }
      }
    }
  }
  return @($publicationDirtyPaths | Sort-Object -Unique)
}

function Restore-GqPublicationPaths {
  $dirtyPaths = @(Get-GqPublicationDirtyPaths)
  if ($dirtyPaths.Count -eq 0) { return }

  Invoke-Git -Arguments (@("restore", "--staged", "--worktree", "--") + $dirtyPaths) | Out-Null
  $remainingDirtyPaths = @(Get-GqPublicationDirtyPaths)
  if ($remainingDirtyPaths.Count -gt 0) {
    throw "GQ publication cleanup incomplete: remainingDirtyCount=$($remainingDirtyPaths.Count); paths=$($remainingDirtyPaths -join ', ')"
  }
}

function Send-GqFailurePushDeer {
  param(
    [ValidateSet("startup", "git-publication")][string]$FailureType,
    [string]$Stage = "",
    [string]$Reason,
    [ValidateSet("", "success", "failure")][string]$CleanupStatus = "",
    [int]$RemainingDirtyCount = 0,
    [string]$CleanupReason = ""
  )

  try {
    $payloadBase64 = [System.Convert]::ToBase64String(
      [System.Text.Encoding]::UTF8.GetBytes((@{
        failureType = $FailureType
        stage = $Stage
        reason = $Reason
        cleanupStatus = $CleanupStatus
        remainingDirtyCount = $RemainingDirtyCount
        cleanupReason = $CleanupReason
      } | ConvertTo-Json -Compress))
    )
    $notifierModuleUrl = [System.Uri]::new((Resolve-Path -LiteralPath $PushDeerNotifier).Path).AbsoluteUri
    $notifierScript = @'
const { sendPushDeerNotification } = await import("NOTIFIER_MODULE_URL");
const payload = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
const body = payload.failureType === "startup"
  ? `\u72b6\u6001\uff1a\u542f\u52a8\u5931\u8d25\nProduction\uff1a\u672a\u4fee\u6539\n\u539f\u56e0\uff1a${payload.reason}`
  : payload.stage === "push"
    ? `\u72b6\u6001\uff1aGit \u53d1\u5e03\u5931\u8d25\n\u9636\u6bb5\uff1apush\n\u672c\u5730 Commit\uff1a\u5df2\u521b\u5efa\norigin/main\uff1a\u672a\u66f4\u65b0\nCleanup\uff1a${payload.cleanupStatus === "success" ? "\u6210\u529f" : "\u5931\u8d25"}\n\u539f\u56e0\uff1a${payload.reason}`
    : payload.cleanupStatus === "success"
      ? `\u72b6\u6001\uff1aGit \u53d1\u5e03\u5931\u8d25\n\u9636\u6bb5\uff1a${payload.stage}\nCleanup\uff1a\u6210\u529f\nProduction\uff1a\u672c\u8f6e\u672c\u5730 publication \u4fee\u6539\u5df2\u6062\u590d\norigin/main\uff1a\u672a\u66f4\u65b0\n\u539f\u56e0\uff1a${payload.reason}`
      : `\u72b6\u6001\uff1aGit \u53d1\u5e03\u5931\u8d25\n\u9636\u6bb5\uff1a${payload.stage}\nCleanup\uff1a\u5931\u8d25\n\u5269\u4f59 Dirty\uff1a${payload.remainingDirtyCount}\nCleanup\u539f\u56e0\uff1a${payload.cleanupReason}\n\u539f\u59cb\u539f\u56e0\uff1a${payload.reason}`;
const message = {
  title: "\u70df\u6597\u6d3e\u5e93\u5b58\u65e5\u62a5\uff5cGQ Tobaccos \u274c",
  body,
};
const result = await sendPushDeerNotification(message);
console.log(JSON.stringify({
  notificationSent: result.notificationSent,
  notificationSkipped: result.notificationSkipped,
  notificationReason: result.notificationReason,
}));
'@
    $notifierScript = $notifierScript.Replace("NOTIFIER_MODULE_URL", $notifierModuleUrl)
    $notifierScriptBase64 = [System.Convert]::ToBase64String(
      [System.Text.Encoding]::UTF8.GetBytes($notifierScript)
    )
    $notifierLauncher = 'await import(`data:text/javascript;base64,${process.argv[1]}`);'
    $notificationNode = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
    & $notificationNode.Source "--input-type=module" "-e" $notifierLauncher $notifierScriptBase64 $payloadBase64
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "GQ failure PushDeer notifier exited with code $LASTEXITCODE."
    }
  } catch {
    Write-Warning "GQ failure PushDeer notification could not be sent: $($_.Exception.Message)"
  }
}

if ($TestNotification) {
  if (-not (Test-Path -LiteralPath $Runner -PathType Leaf)) {
    throw "GQ runner is missing: $Runner"
  }
  if ($ApplyProduction -or $NoProductionWrite -or $NoPush -or $PreflightOnly -or $ApplyCandidatePath -or $ReportPath) {
    throw "-TestNotification cannot be combined with Daily or Production switches."
  }
  $node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
  & $node.Source $Runner "--test-notification"
  exit $LASTEXITCODE
}
if ($ApplyProduction -and ($NoProductionWrite -or $PreflightOnly)) {
  throw "-ApplyProduction cannot be combined with -NoProductionWrite or -PreflightOnly."
}

function Restore-GqRuntimeAfterPushFailure {
  # A failed push must not leave the shared production checkout ahead of
  # origin/main, because Danish's publisher also uses this checkout.
  Invoke-Git -Arguments @("reset", "--hard", "origin/main") | Out-Null
  Assert-TrackedRuntimeClean
}
if ($ApplyCandidatePath -and ($NoProductionWrite -or $PreflightOnly -or $TestNotification)) {
  throw "-ApplyCandidatePath cannot be combined with -NoProductionWrite, -PreflightOnly, or -TestNotification."
}
if ($ReportPath -and ($NoProductionWrite -or $PreflightOnly -or $TestNotification)) {
  throw "-ReportPath cannot be combined with -NoProductionWrite, -PreflightOnly, or -TestNotification."
}

# The Node runner acquires data/inventory/state/smokingpipes.lock, the existing
# shared inventory owner lock, before touching source or generated data.
try {
  if (-not (Test-Path -LiteralPath $Runner -PathType Leaf)) {
    throw "GQ runner is missing: $Runner"
  }
  Assert-TrackedRuntimeClean
  $syncResult = Sync-FormalMainRuntime
  $node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
} catch {
  Send-GqFailurePushDeer -FailureType "startup" -Reason $_.Exception.Message
  Write-Error "GQ startup failed: $($_.Exception.Message)"
  exit 1
}

if ($syncResult -eq "retained-commit-push-required") {
  try {
    $script:ProductionPublishLock = Acquire-ProductionPublishLock
    Invoke-GitFetchWithRetry
    Invoke-GitPushWithRetry
  } catch {
    $publicationError = $_.Exception.Message
    $failureStage = if ($publicationError -match "publisher-lock-(?:timeout|acquire-failed)") { "publisher-lock-timeout" } else { "push" }
    $cleanupStatus = "success"
    $cleanupReason = ""
    try { Restore-GqRuntimeAfterPushFailure } catch {
      $cleanupStatus = "failure"
      $cleanupReason = $_.Exception.Message
    }
    Release-GqProductionPublishLock
    Send-GqFailurePushDeer -FailureType "git-publication" -Stage $failureStage -Reason $publicationError -CleanupStatus $cleanupStatus -CleanupReason $cleanupReason
    Write-Error "GQ retained publication commit push failed: $publicationError"
    exit 1
  }
  Release-GqProductionPublishLock
  Write-Output "GQ retained publication commit pushed; runner was not started."
  exit 0
}

if ($PreflightOnly) {
  Write-Output "GQ runtime preflight and sync completed; runner was not started."
  exit 0
}

if (-not $ApplyCandidatePath) {
  $arguments = @($Runner, "--live")
  if ($ApplyProduction) { $arguments += "--notify-on-failure" }
  $collectionResult = Invoke-GqNodeCommand -Arguments $arguments
  $collectionResult.Output | ForEach-Object { Write-Output $_ }
  if ($collectionResult.ExitCode -ne 0) { exit $collectionResult.ExitCode }
  if (-not $ApplyProduction -or $NoProductionWrite) {
    Write-Output "GQ V1 completed as dry-run; Production, commit, and push were not requested."
    exit 0
  }
  try {
    $dailyReport = ($collectionResult.Output | Out-String | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    throw "GQ collection returned invalid JSON; $($collectionResult.Output | Select-Object -Last 40 | Out-String)"
  }
  if (-not $dailyReport.allowPublish -or -not $dailyReport.artifactRoot) {
    throw "GQ collection did not produce an approved Production candidate."
  }
  $ApplyCandidatePath = Join-Path $RuntimeRoot (Join-Path ([string]$dailyReport.artifactRoot) "candidate-products.json")
  $ReportPath = Join-Path $RuntimeRoot (Join-Path ([string]$dailyReport.artifactRoot) "report.json")
}

try {
  $script:ProductionPublishLock = Acquire-ProductionPublishLock
  # Final fetch/ff-only sync is inside the mutex immediately before any
  # tracked Production write or Git publication.
  $lockedSyncResult = Sync-FormalMainRuntime
  if ($lockedSyncResult -eq "retained-commit-push-required") {
    throw "GQ retained publication commit became stale while waiting for publisher lock"
  }
  $script:PublicationBaseHead = Invoke-Git -Arguments @("rev-parse", "origin/main")
  Write-Output "GQ publication BASE_HEAD=$($script:PublicationBaseHead)"
  Invoke-GqCandidateApply -CandidatePath $ApplyCandidatePath
  $changed = Invoke-Git -Arguments @("status", "--porcelain", "--untracked-files=no")
  if (-not $changed) {
    Release-GqProductionPublishLock
    if ($ReportPath) { Invoke-GqSuccessNotification -DailyReportPath $ReportPath }
    Write-Output "GQ V1 Production apply produced no tracked change."
    exit 0
  }
} catch {
  $publicationError = $_.Exception.Message
  $failureStage = if ($publicationError -match "publisher-lock-(?:timeout|acquire-failed)") { "publisher-lock-timeout" } else { $script:PublicationStage }
  if (-not $script:PublicationCommitSha) {
    try { Restore-GqPublicationPaths } catch { Write-Warning "GQ publication rollback failed: $($_.Exception.Message)" }
  }
  Release-GqProductionPublishLock
  Send-GqFailurePushDeer -FailureType "git-publication" -Stage $failureStage -Reason $publicationError
  Write-Error "GQ Production apply failed: $publicationError"
  exit 1
}

$script:PublicationStage = "add"
try {
  Invoke-Git -Arguments (@("add", "--") + $PublicationPaths) | Out-Null
  $script:PublicationStage = "commit"
  Invoke-Git -Arguments @("commit", "-m", "chore(inventory): publish GQ Tobaccos daily update") | Out-Null
  $script:PublicationCommitSha = Invoke-Git -Arguments @("rev-parse", "HEAD")
} catch {
  $publicationError = $_.Exception.Message
  $cleanupStatus = "success"
  $cleanupReason = ""
  $remainingDirtyCount = 0
  try {
    Restore-GqPublicationPaths
  } catch {
    $cleanupStatus = "failure"
    $cleanupReason = $_.Exception.Message
    try {
      $remainingDirtyPaths = @(Get-GqPublicationDirtyPaths)
      $remainingDirtyCount = $remainingDirtyPaths.Count
    } catch {
      $cleanupReason = "$cleanupReason; remaining-dirty inspection failed: $($_.Exception.Message)"
      $remainingDirtyCount = -1
    }
    Write-Warning "GQ Git publication cleanup failed: $cleanupReason"
  }
  Release-GqProductionPublishLock
  Send-GqFailurePushDeer -FailureType "git-publication" -Stage $script:PublicationStage -Reason $publicationError -CleanupStatus $cleanupStatus -RemainingDirtyCount $remainingDirtyCount -CleanupReason $cleanupReason
  Write-Error "GQ Git publication failed during $($script:PublicationStage): $publicationError"
  exit 1
}

if ($NoPush) {
  Release-GqProductionPublishLock
  Write-Output "GQ V1 production commit created; push was explicitly disabled."
  exit 0
}

try {
  Invoke-GitPushWithRetry
} catch {
  $publicationError = $_.Exception.Message
  $cleanupStatus = "success"
  $cleanupReason = ""
  try { Restore-GqRuntimeAfterPushFailure } catch {
    $cleanupStatus = "failure"
    $cleanupReason = $_.Exception.Message
  }
  Release-GqProductionPublishLock
  Send-GqFailurePushDeer -FailureType "git-publication" -Stage "push" -Reason $publicationError -CleanupStatus $cleanupStatus -CleanupReason $cleanupReason
  Write-Error "GQ Git publication failed during push: $publicationError"
  exit 1
}
Release-GqProductionPublishLock
if ($ReportPath) { Invoke-GqSuccessNotification -DailyReportPath $ReportPath }
Write-Output "GQ V1 production update committed and pushed."
