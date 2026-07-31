param(
  [string]$StateRoot = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-state",
  [string]$ReleaseRoot = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-release",
  [ValidateRange(1, 200)]
  [int]$ProgressiveDetailMax = 50,
  [ValidateRange(1, 2000)]
  [int]$MaxAutoApply = 2000,
  [switch]$NoProductionWrite,
  [switch]$NoPush,
  [switch]$PreflightOnly,
  [switch]$NoLiveCollection,
  [string]$CycleId = ""
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Orchestrator = Join-Path $PSScriptRoot "smokingpipes-auto-publish-v2.mjs"

if (-not (Test-Path -LiteralPath $Orchestrator -PathType Leaf)) {
  throw "Smokingpipes V2 orchestrator is missing: $Orchestrator"
}
if ([IO.Path]::GetFullPath($StateRoot).StartsWith([IO.Path]::GetFullPath($RuntimeRoot), [StringComparison]::OrdinalIgnoreCase)) {
  throw "StateRoot must be outside the runtime Git worktree"
}

$arguments = @(
  $Orchestrator,
  "--state-root=$StateRoot",
  "--runtime-root=$RuntimeRoot",
  "--release-root=$ReleaseRoot",
  "--detail-limit=$ProgressiveDetailMax",
  "--max-auto-apply=$MaxAutoApply"
)
if ($CycleId) { $arguments += "--cycle-id=$CycleId" }
if ($NoProductionWrite -or $PreflightOnly) { $arguments += "--no-publish=true" }
if ($NoPush) { $arguments += "--no-push=true" }
if ($NoLiveCollection -or $PreflightOnly) {
  $arguments += "--live=false"
} else {
  $arguments += "--live=true"
}

$output = @(& node @arguments 2>&1)
$output | ForEach-Object { Write-Output $_ }
exit $LASTEXITCODE
