param(
  [string]$StateRoot = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-state",
  [string]$ReleaseRoot = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-release",
  [ValidateRange(1, 50)]
  [int]$ProgressiveDetailMax = 50,
  [ValidateRange(1, 2000)]
  [int]$MaxAutoApply = 2000,
  [ValidateRange(1, 14400)]
  [int]$DailyTimeoutSeconds = 3600,
  [switch]$NoProductionWrite,
  [switch]$NoPush,
  [switch]$PreflightOnly,
  [switch]$NoLiveCollection,
  [string]$CycleId = ""
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Orchestrator = Join-Path $PSScriptRoot "smokingpipes-auto-publish-v2.mjs"

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
  if ($dirty) {
    throw "runtime tracked worktree is not clean: $dirty"
  }
}

if (-not (Test-Path -LiteralPath $Orchestrator -PathType Leaf)) {
  throw "Smokingpipes V2 orchestrator is missing: $Orchestrator"
}
if ([IO.Path]::GetFullPath($StateRoot).StartsWith([IO.Path]::GetFullPath($RuntimeRoot), [StringComparison]::OrdinalIgnoreCase)) {
  throw "StateRoot must be outside the runtime Git worktree"
}

# A scheduled process must never load Node modules before it has synchronized
# the worktree. This keeps the orchestrator and publisher on one runtime SHA.
Write-Output "SCHEDULER_STAGE runtime-check"
Assert-TrackedRuntimeClean
Write-Output "SCHEDULER_STAGE git-fetch"
Invoke-Git -Arguments @("fetch", "origin") | Out-Null
$head = Invoke-Git -Arguments @("rev-parse", "HEAD")
$remoteMain = Invoke-Git -Arguments @("rev-parse", "origin/main")
if ($head -ne $remoteMain) {
  Write-Output "SCHEDULER_STAGE git-fast-forward"
  & git -C $RuntimeRoot merge-base --is-ancestor HEAD origin/main 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "runtime is ahead of or diverged from origin/main; automatic sync is blocked"
  }
  Invoke-Git -Arguments @("merge", "--ff-only", "origin/main") | Out-Null
}
Assert-TrackedRuntimeClean
$runtimeSha = Invoke-Git -Arguments @("rev-parse", "HEAD")
$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop

$arguments = @(
  $Orchestrator,
  "--state-root=$StateRoot",
  "--runtime-root=$RuntimeRoot",
  "--release-root=$ReleaseRoot",
  "--detail-limit=$ProgressiveDetailMax",
  "--max-auto-apply=$MaxAutoApply",
  # ===== BEGIN PROTECTED OPTIMIZATION: Daily timeout reaches the Node orchestrator =====
  "--timeout-seconds=$DailyTimeoutSeconds",
  # ===== END PROTECTED OPTIMIZATION =====
  "--skip-sync=true",
  "--expected-runtime-sha=$runtimeSha"
)
if ($CycleId) { $arguments += "--cycle-id=$CycleId" }
if ($NoProductionWrite -or $PreflightOnly) { $arguments += "--no-publish=true" }
if ($PreflightOnly) { $arguments += "--preflight-only=true" }
if ($NoPush) { $arguments += "--no-push=true" }
if (-not $PreflightOnly) { $arguments += "--notify=true" }
if ($NoLiveCollection -or $PreflightOnly) {
  $arguments += "--live=false"
} else {
  $arguments += "--live=true"
}

$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  Write-Output "SCHEDULER_STAGE node-start"
  # ===== BEGIN PROTECTED OPTIMIZATION: stream Node output in real time =====
  # PowerShell 5.1 represents native stderr as ErrorRecord. Convert each
  # record to text before forwarding so ordinary Node scheduler logs do not
  # appear as red NativeCommandError records, while preserving $LASTEXITCODE.
  & $nodeCommand.Source @arguments 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) {
      Write-Output ([string]$_.Exception.Message)
    } else {
      Write-Output ([string]$_)
    }
  }
  $nodeExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
exit $nodeExitCode
