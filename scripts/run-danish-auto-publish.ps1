[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$CollectOnly,
  [switch]$Daily,
  [switch]$Publish,
  [ValidateRange(30, 86400)]
  [int]$DailyTimeoutSeconds = 14400,
  [string]$RunId = "",
  [string]$RawRoot = ""
)

$ErrorActionPreference = "Stop"

$selectedModes = @($DryRun, $CollectOnly, $Daily, $Publish).Where({ $_ }).Count
if ($selectedModes -gt 1) {
  throw "Select only one mode: -DryRun, -CollectOnly, -Daily, or -Publish."
}

# No mode is deliberately safe: it performs an offline DryRun and never publishes.
$mode = if ($Publish) {
  "publish"
} elseif ($Daily) {
  "daily"
} elseif ($CollectOnly) {
  "collect-only"
} else {
  "dry-run"
}

$root = Split-Path -Parent $PSScriptRoot
$nodeScript = Join-Path $root "scripts\inventory\run-danish-daily-v1.mjs"
if (-not (Test-Path -LiteralPath $nodeScript -PathType Leaf)) {
  throw "Danish daily runner not found: $nodeScript"
}

Set-Location -LiteralPath $root
$arguments = @(
  $nodeScript,
  "--mode=$mode",
  "--timeout-seconds=$DailyTimeoutSeconds"
)
if ($RunId) { $arguments += "--run-id=$RunId" }
if ($RawRoot) { $arguments += "--raw-root=$RawRoot" }

Write-Host "Danish daily mode: $mode"
Write-Host "Danish daily runner: $nodeScript"
if ($RunId) { Write-Host "RunId: $RunId" }
if ($RawRoot) { Write-Host "Raw root: $RawRoot" }

& node @arguments
exit $LASTEXITCODE
