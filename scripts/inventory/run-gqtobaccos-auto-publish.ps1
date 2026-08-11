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

function Invoke-Git {
  param([string[]]$Arguments)
  $output = @(& git -C $RuntimeRoot @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "git command failed: git -C '$RuntimeRoot' $($Arguments -join ' '); output=$($output | Out-String)"
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

function Send-GqStartupFailurePushDeer {
  param([System.Management.Automation.ErrorRecord]$ErrorRecord)

  try {
    $reason = [string]$ErrorRecord.Exception.Message
    $reasonBase64 = [System.Convert]::ToBase64String(
      [System.Text.Encoding]::UTF8.GetBytes(($reason | ConvertTo-Json -Compress))
    )
    $notifierModuleUrl = [System.Uri]::new((Resolve-Path -LiteralPath $PushDeerNotifier).Path).AbsoluteUri
    $notifierScript = @'
const { sendPushDeerNotification } = await import("NOTIFIER_MODULE_URL");
const reason = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
const message = {
  title: "\u70df\u6597\u6d3e\u5e93\u5b58\u65e5\u62a5\uff5cGQ Tobaccos \u274c",
  body: `\u72b6\u6001\uff1a\u542f\u52a8\u5931\u8d25\nProduction\uff1a\u672a\u4fee\u6539\n\u539f\u56e0\uff1a${reason}`,
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
    & $notificationNode.Source "--input-type=module" "-e" $notifierLauncher $notifierScriptBase64 $reasonBase64
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "GQ startup failure PushDeer notifier exited with code $LASTEXITCODE."
    }
  } catch {
    Write-Warning "GQ startup failure PushDeer notification could not be sent: $($_.Exception.Message)"
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
  Send-GqStartupFailurePushDeer -ErrorRecord $_
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

Invoke-Git -Arguments @(
  "add", "--",
  "data/products/gqtobaccos-products.json",
  "data/products/unified-products-staging.json",
  "data/generated/public-products",
  "data/review/round5-public-index-build-v1.json",
  "data/review/round5-public-index-build-v1.md",
  "data/review/round5-public-index-field-contract-v1.md"
) | Out-Null
Invoke-Git -Arguments @("commit", "-m", "chore(inventory): publish GQ Tobaccos daily update") | Out-Null

if ($NoPush) {
  Write-Output "GQ V1 production commit created; push was explicitly disabled."
  exit 0
}

Invoke-Git -Arguments @("push", "origin", "HEAD") | Out-Null
Write-Output "GQ V1 production update committed and pushed."
