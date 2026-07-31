param(
  [string]$AutomationWorktree = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-run",
  [string]$StateRoot = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-state",
  [string]$ReleaseRoot = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-release",
  [ValidateRange(1, 200)]
  [int]$ProgressiveDetailMax = 50,
  [ValidateRange(1, 2000)]
  [int]$MaxAutoApply = 2000,
  [ValidateRange(900, 14400)]
  [int]$DailyTimeoutSeconds = 3600,
  [string]$CycleId = ""
)

$ErrorActionPreference = "Stop"
$runtimeRoot = (Resolve-Path -LiteralPath $AutomationWorktree).Path
$wrapper = Join-Path $runtimeRoot "scripts\inventory\run-smokingpipes-auto-publish.ps1"
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) {
  throw "Smokingpipes V2 scheduled wrapper is missing: $wrapper"
}

# This historical filename remains a compatibility entrypoint only. It must not
# run the legacy daily writer, development regression suite, or write Git data.
$arguments = @(
  "-StateRoot", $StateRoot,
  "-ReleaseRoot", $ReleaseRoot,
  "-ProgressiveDetailMax", $ProgressiveDetailMax,
  "-MaxAutoApply", $MaxAutoApply
)
if ($CycleId) { $arguments += @("-CycleId", $CycleId) }
& $wrapper @arguments
exit $LASTEXITCODE
