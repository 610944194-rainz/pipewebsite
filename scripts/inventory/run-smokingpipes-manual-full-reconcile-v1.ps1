param(
  [switch]$PlanOnly,
  [switch]$RebuildState,
  [switch]$RepairState,
  [switch]$PromoteNextBatch,
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

$SelectedModes = @($PlanOnly, $RebuildState, $RepairState, $PromoteNextBatch, $FetchDetailBatch) | Where-Object { $_ }
if ($SelectedModes.Count -gt 1) {
  throw "Choose only one mode: PlanOnly, RebuildState, RepairState, PromoteNextBatch, or FetchDetailBatch."
}

if ($WriteProduction -and -not $ApplySafeSubset) {
  throw "WriteProduction requires ApplySafeSubset."
}

if ($RefreshSnapshot) {
  throw "RefreshSnapshot is disabled for this phase. FetchDetailBatch must reuse the existing manual reconcile state and must not rebuild the current-list snapshot."
}

if ($ApplySafeSubset -or $WriteProduction) {
  throw "ApplySafeSubset and WriteProduction are reserved for a later approved phase. This offline phase cannot write production."
}

$Mode = if ($RebuildState) {
  "rebuild-state"
} elseif ($RepairState) {
  "repair-state"
} elseif ($PromoteNextBatch) {
  "promote-next-batch"
} elseif ($FetchDetailBatch) {
  "fetch-detail-batch"
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

if ($Mode -eq "fetch-detail-batch") {
  $NodeArguments += @(
    "--browser-channel=chrome",
    "--browser-profile=sp-chrome",
    "--allow-manual-verification=true",
    "--detail-warmup-min-ms=1000",
    "--detail-warmup-max-ms=3000",
    "--detail-delay-min-ms=3000",
    "--detail-delay-max-ms=8000",
    "--verbose=true"
  )
}

Write-Host "Smokingpipes Manual Full Reconcile V1"
Write-Host "Mode: $Mode"
Write-Host "DetailMax: $DetailMax"
Write-Host "Network access: $([string]($Mode -eq "fetch-detail-batch"))"
Write-Host "Detail fetch: $([string]($Mode -eq "fetch-detail-batch"))"
if ($Mode -eq "promote-next-batch") {
  Write-Host "Promote next batch: enabled"
  Write-Host "Current-list refresh: disabled"
  Write-Host "Detail fetch: disabled"
  Write-Host "Daily task: disabled"
}
if ($Mode -eq "repair-state") {
  Write-Host "State repair: enabled"
  Write-Host "Current-list refresh: disabled"
  Write-Host "Daily task: disabled"
}
if ($Mode -eq "fetch-detail-batch") {
  Write-Host "Browser: Chrome profile sp-chrome"
  Write-Host "Current-list refresh: disabled"
  Write-Host "Daily task: disabled"
}
Write-Host "Production write: disabled"

& node @NodeArguments
$ExitCode = $LASTEXITCODE
if ($ExitCode -ne 0) {
  throw "Manual full reconcile $Mode failed with exit code $ExitCode."
}

exit 0
