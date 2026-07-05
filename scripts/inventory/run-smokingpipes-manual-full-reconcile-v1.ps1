param(
  [switch]$PlanOnly,
  [switch]$RebuildState,
  [switch]$RefreshSnapshot,
  [switch]$FetchDetailBatch,
  [switch]$ApplySafeSubset,
  [switch]$WriteProduction,
  [ValidateRange(1, 30)]
  [int]$DetailMax = 30
)

$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\NING MEI\Desktop\pipewebsite"
$CoreScript = "scripts/inventory/smokingpipes-manual-full-reconcile-v1.mjs"
$StatePath = Join-Path $ProjectRoot "data\inventory\smokingpipes-progressive-daily-state.json"

Set-Location $ProjectRoot

if ($PlanOnly -and $RebuildState) {
  throw "Choose either PlanOnly or RebuildState, not both."
}

if ($WriteProduction -and -not $ApplySafeSubset) {
  throw "WriteProduction requires ApplySafeSubset."
}

if ($RefreshSnapshot) {
  throw "RefreshSnapshot is reserved for a later manual online phase. This offline phase did not start a browser or access Smokingpipes."
}

if ($FetchDetailBatch) {
  throw "FetchDetailBatch is reserved for a later manual online phase. This offline phase did not start detail fetching."
}

if ($ApplySafeSubset -or $WriteProduction) {
  throw "ApplySafeSubset and WriteProduction are reserved for a later approved phase. This offline phase cannot write production."
}

$Mode = if ($RebuildState) {
  "rebuild-state"
} else {
  "plan-only"
}

$NodeArguments = @(
  $CoreScript
  "--mode=$Mode"
  "--detail-max=$DetailMax"
)

if ($Mode -eq "rebuild-state") {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    throw "Progressive state is missing: $StatePath"
  }

  $Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $BackupDirectory = Join-Path $ProjectRoot "data\backups\$Timestamp-smokingpipes-manual-full-reconcile-state"
  $StateBackupPath = Join-Path $BackupDirectory "smokingpipes-progressive-daily-state.json"
  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
  Copy-Item -LiteralPath $StatePath -Destination $StateBackupPath

  $SourceHash = (Get-FileHash -LiteralPath $StatePath -Algorithm SHA256).Hash
  $BackupHash = (Get-FileHash -LiteralPath $StateBackupPath -Algorithm SHA256).Hash
  if ($SourceHash -ne $BackupHash) {
    throw "State backup hash verification failed."
  }

  $NodeArguments += "--state-backup=$StateBackupPath"
  Write-Host "State backup created: $StateBackupPath"
}

Write-Host "Smokingpipes Manual Full Reconcile V1"
Write-Host "Mode: $Mode"
Write-Host "DetailMax: $DetailMax"
Write-Host "Network access: disabled"
Write-Host "Detail fetch: disabled"
Write-Host "Production write: disabled"

& node @NodeArguments
$ExitCode = $LASTEXITCODE
if ($ExitCode -ne 0) {
  throw "Manual full reconcile $Mode failed with exit code $ExitCode."
}

exit 0
