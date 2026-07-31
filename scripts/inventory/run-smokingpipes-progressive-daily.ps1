param(
  [string]$StateRoot = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-state",
  [ValidateRange(1, 200)]
  [int]$ProgressiveDetailMax = 50,
  [ValidateRange(1, 2000)]
  [int]$MaxAutoApply = 2000,
  [switch]$NoLiveCollection,
  [string]$CycleId = ""
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Collector = Join-Path $PSScriptRoot "smokingpipes-collect-only-v2.mjs"

if (-not (Test-Path -LiteralPath $Collector -PathType Leaf)) {
  throw "Smokingpipes V2 collect-only runner is missing: $Collector"
}
if ([IO.Path]::GetFullPath($StateRoot).StartsWith([IO.Path]::GetFullPath($RuntimeRoot), [StringComparison]::OrdinalIgnoreCase)) {
  throw "StateRoot must be outside the runtime Git worktree"
}

$arguments = @(
  $Collector,
  "--state-root=$StateRoot",
  "--runtime-root=$RuntimeRoot",
  "--detail-limit=$ProgressiveDetailMax",
  "--max-auto-apply=$MaxAutoApply"
)
if ($CycleId) { $arguments += "--cycle-id=$CycleId" }
if ($NoLiveCollection) {
  $arguments += "--live=false"
} else {
  $arguments += "--live=true"
}

$output = @(& node @arguments 2>&1)
$output | ForEach-Object { Write-Output $_ }
exit $LASTEXITCODE
