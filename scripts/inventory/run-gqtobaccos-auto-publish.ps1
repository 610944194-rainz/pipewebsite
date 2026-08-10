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

function Sync-FormalMainRuntime {
  $branch = Invoke-Git -Arguments @("branch", "--show-current")
  if ($branch -ne "main") {
    throw "GQ scheduled runtime must run from the formal main worktree; actual branch=$branch"
  }

  Invoke-Git -Arguments @("fetch", "origin") | Out-Null
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

if (-not (Test-Path -LiteralPath $Runner -PathType Leaf)) {
  throw "GQ runner is missing: $Runner"
}
if ($TestNotification) {
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
Assert-TrackedRuntimeClean
Sync-FormalMainRuntime
$node = Get-Command node -CommandType Application -ErrorAction Stop
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
