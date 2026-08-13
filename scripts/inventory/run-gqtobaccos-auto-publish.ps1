param(
  [switch]$NoProductionWrite,
  [switch]$NoPush,
  [switch]$PreflightOnly,
  [switch]$ApplyProduction,
  [switch]$TestNotification
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Runner = Join-Path $PSScriptRoot "run-gqtobaccos-daily-v1.mjs"
$PushDeerNotifier = Join-Path $PSScriptRoot "inventory-pushdeer-notifier-v1.mjs"
$PublicationPaths = @(
  "data/products/gqtobaccos-products.json",
  "data/products/unified-products-staging.json",
  "data/generated/public-products",
  "data/review/round5-public-index-build-v1.json",
  "data/review/round5-public-index-build-v1.md",
  "data/review/round5-public-index-field-contract-v1.md"
)

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

function Sync-FormalMainRuntime {
  $branch = Invoke-Git -Arguments @("branch", "--show-current")
  if ($branch -ne "main") {
    throw "GQ scheduled runtime must run from the formal main worktree; actual branch=$branch"
  }

  Invoke-GitFetchWithRetry
  $head = Invoke-Git -Arguments @("rev-parse", "HEAD")
  $originMain = Invoke-Git -Arguments @("rev-parse", "origin/main")
  if ($head -eq $originMain) { return }

  & git -C $RuntimeRoot merge-base --is-ancestor HEAD origin/main 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "formal main runtime is ahead of or diverged from origin/main; automatic GQ sync is blocked"
  }
  Invoke-Git -Arguments @("merge", "--ff-only", "origin/main") | Out-Null
  Assert-TrackedRuntimeClean
}

function Restore-GqPublicationPaths {
  Invoke-Git -Arguments (@("restore", "--staged", "--worktree", "--") + $PublicationPaths) | Out-Null
}

function Send-GqFailurePushDeer {
  param(
    [ValidateSet("startup", "git-publication")][string]$FailureType,
    [string]$Stage = "",
    [string]$Reason
  )

  try {
    $payloadBase64 = [System.Convert]::ToBase64String(
      [System.Text.Encoding]::UTF8.GetBytes((@{
        failureType = $FailureType
        stage = $Stage
        reason = $Reason
      } | ConvertTo-Json -Compress))
    )
    $notifierModuleUrl = [System.Uri]::new((Resolve-Path -LiteralPath $PushDeerNotifier).Path).AbsoluteUri
    $notifierScript = @'
const { sendPushDeerNotification } = await import("NOTIFIER_MODULE_URL");
const payload = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
const body = payload.failureType === "startup"
  ? `\u72b6\u6001\uff1a\u542f\u52a8\u5931\u8d25\nProduction\uff1a\u672a\u4fee\u6539\n\u539f\u56e0\uff1a${payload.reason}`
  : payload.stage === "push"
    ? `\u72b6\u6001\uff1aGit \u53d1\u5e03\u5931\u8d25\n\u9636\u6bb5\uff1apush\n\u672c\u5730 Commit\uff1a\u5df2\u521b\u5efa\norigin/main\uff1a\u672a\u66f4\u65b0\n\u539f\u56e0\uff1a${payload.reason}`
    : `\u72b6\u6001\uff1aGit \u53d1\u5e03\u5931\u8d25\n\u9636\u6bb5\uff1a${payload.stage}\nProduction\uff1a\u672c\u8f6e\u672c\u5730\u4fee\u6539\u5df2\u6062\u590d\uff0corigin/main \u672a\u66f4\u65b0\n\u539f\u56e0\uff1a${payload.reason}`;
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
    $notificationNode = Get-Command node -CommandType Application -ErrorAction Stop
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
  if ($ApplyProduction -or $NoProductionWrite -or $NoPush -or $PreflightOnly) {
    throw "-TestNotification cannot be combined with Daily or Production switches."
  }
  $node = Get-Command node -CommandType Application -ErrorAction Stop
  & $node.Source $Runner "--test-notification"
  exit $LASTEXITCODE
}
if ($ApplyProduction -and ($NoProductionWrite -or $PreflightOnly)) {
  throw "-ApplyProduction cannot be combined with -NoProductionWrite or -PreflightOnly."
}

# The Node runner acquires data/inventory/state/smokingpipes.lock, the existing
# shared inventory owner lock, before touching source or generated data.
try {
  if (-not (Test-Path -LiteralPath $Runner -PathType Leaf)) {
    throw "GQ runner is missing: $Runner"
  }
  Assert-TrackedRuntimeClean
  Sync-FormalMainRuntime
  $node = Get-Command node -CommandType Application -ErrorAction Stop
} catch {
  Send-GqFailurePushDeer -FailureType "startup" -Reason $_.Exception.Message
  Write-Error "GQ startup failed: $($_.Exception.Message)"
  exit 1
}

if ($PreflightOnly) {
  Write-Output "GQ runtime preflight and sync completed; runner was not started."
  exit 0
}

$arguments = @($Runner, "--live")
if ($ApplyProduction) {
  $arguments += "--apply-production"
  $arguments += "--notify"
}

& $node.Source @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $ApplyProduction -or $NoProductionWrite -or $PreflightOnly) {
  Write-Output "GQ V1 completed as dry-run; Production, commit, and push were not requested."
  exit 0
}

$changed = Invoke-Git -Arguments @("status", "--porcelain", "--untracked-files=no")
if (-not $changed) {
  Write-Output "GQ V1 production apply produced no tracked change."
  exit 0
}

$publicationStage = "add"
try {
  Invoke-Git -Arguments (@("add", "--") + $PublicationPaths) | Out-Null
  $publicationStage = "commit"
  Invoke-Git -Arguments @("commit", "-m", "chore(inventory): publish GQ Tobaccos daily update") | Out-Null
} catch {
  $publicationError = $_.Exception.Message
  try {
    Restore-GqPublicationPaths
  } catch {
    Write-Warning "GQ Git publication cleanup failed: $($_.Exception.Message)"
  }
  Send-GqFailurePushDeer -FailureType "git-publication" -Stage $publicationStage -Reason $publicationError
  Write-Error "GQ Git publication failed during ${publicationStage}: $publicationError"
  exit 1
}

if ($NoPush) {
  Write-Output "GQ V1 production commit created; push was explicitly disabled."
  exit 0
}

try {
  Invoke-Git -Arguments @("push", "origin", "HEAD") | Out-Null
} catch {
  $publicationError = $_.Exception.Message
  Send-GqFailurePushDeer -FailureType "git-publication" -Stage "push" -Reason $publicationError
  Write-Error "GQ Git publication failed during push: $publicationError"
  exit 1
}
Write-Output "GQ V1 production update committed and pushed."
