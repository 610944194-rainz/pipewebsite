[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$AutomationWorktree,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$RunId,
  [switch]$ListOnly,
  [switch]$Resume,
  [int]$DetailChunkSize = 30,
  [int]$MaxDetailItems = 30,
  [switch]$SkipExistingCompleteDetails,
  [switch]$ReportOnly,
  # Test-only local input: this avoids all network calls and is never required for real collection.
  [string]$FixtureListPath
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date
$root = [IO.Path]::GetFullPath($AutomationWorktree)
$mode = if ($ReportOnly) { 'ReportOnly' } elseif ($ListOnly) { 'ListOnly' } elseif ($Resume) { 'Resume' } else { 'Details' }
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { '' }
$scriptPath = Join-Path $root 'scripts\inventory\danish-full-refresh-preview-v1.mjs'

Write-Host '[START] Danish full refresh' -ForegroundColor Cyan
Write-Host "mode: $mode"
Write-Host "RunId: $RunId"
Write-Host "worktree: $root"
Write-Host "Node executable: $nodeExecutable"
Write-Host "core script path: $scriptPath"

if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "AutomationWorktree does not exist: $root" }
if (-not $nodeExecutable -or -not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw 'Node executable was not found.' }
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "Preview core not found: $scriptPath" }
if ($RunId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$') { throw 'RunId must be 3-81 characters: letters, digits, dot, underscore, hyphen.' }
if ($DetailChunkSize -lt 1 -or $MaxDetailItems -lt 1) { throw 'DetailChunkSize and MaxDetailItems must be positive.' }
if ($FixtureListPath -and -not (Test-Path -LiteralPath $FixtureListPath -PathType Leaf)) { throw "FixtureListPath does not exist: $FixtureListPath" }
$effectiveMaxDetailItems = if ($PSBoundParameters.ContainsKey('MaxDetailItems')) { $MaxDetailItems } else { $DetailChunkSize }

$rawRoot = Join-Path $root (Join-Path 'data\raw\danish-full-refresh' $RunId)
$auditRoot = Join-Path $root (Join-Path 'data\audits\danish-full-refresh' $RunId)
$reviewRoot = Join-Path $root (Join-Path 'data\review\danish-full-refresh' $RunId)
$listPath = Join-Path $rawRoot 'list.json'
$manifestPath = Join-Path $rawRoot 'manifest.json'
$pageAuditPath = Join-Path $auditRoot 'page-audit.json'

if ($ReportOnly) {
  $diffPath = Join-Path $reviewRoot 'diff-preview.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $diffPath -PathType Leaf)) { throw "Run report not found for RunId: $RunId" }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $diff = Get-Content -Raw -LiteralPath $diffPath | ConvertFrom-Json
  [pscustomobject]@{
    RunId = $manifest.runId; TotalPages = $manifest.expectedPages; SuccessfulPages = $manifest.successfulPages; FailedPages = $manifest.failedPages
    UniqueProducts = $manifest.uniqueProducts; Available = $manifest.available; Sold = $manifest.sold; Unknown = $manifest.unknown; Blocked = $manifest.blocked
    DetailSuccess = $manifest.detailSuccess; DetailFailed = $manifest.detailFailed; Pending = $manifest.pending
    New = $diff.counts.new; SoldCandidates = $diff.counts.'available-to-sold'; Restocked = $diff.counts.'sold-to-available'; PriceChanges = $diff.counts.'price-change'
    Missing = $diff.counts.'missing-from-current-list'; ExpectedChanges = $diff.expectedChangeCount; IntegrityGate = $diff.integrityGate.complete
  } | Format-List
  Write-Host '[PASS] Danish ReportOnly' -ForegroundColor Green
  exit 0
}

$nodeArgs = @($scriptPath, '--automation-worktree', $root, '--run-id', $RunId, '--max-detail-items', [string]$effectiveMaxDetailItems)
if ($ListOnly) { $nodeArgs += '--list-only' }
if ($Resume) { $nodeArgs += '--resume' }
if ($SkipExistingCompleteDetails) { $nodeArgs += '--skip-existing-complete-details' }
if ($FixtureListPath) { $nodeArgs += @('--fixture-list', [IO.Path]::GetFullPath($FixtureListPath)) }

Write-Host "[NODE] invoking: $nodeExecutable $($nodeArgs -join ' ')" -ForegroundColor DarkCyan
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $nodeExecutable @nodeArgs 2>&1 | ForEach-Object { Write-Host $_ }
  $nodeExitCode = $LASTEXITCODE
}
finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
if ($nodeExitCode -ne 0) { [Console]::Error.WriteLine("Node collector failed with exit code $nodeExitCode"); exit $nodeExitCode }

foreach ($requiredPath in @($listPath, $manifestPath, $pageAuditPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { [Console]::Error.WriteLine("Node exited 0 but required output was not generated: $requiredPath"); exit 1 }
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$duration = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
Write-Host "[PASS] Danish $mode" -ForegroundColor Green
Write-Host "list path: $listPath"
Write-Host "manifest path: $manifestPath"
Write-Host "page audit path: $pageAuditPath"
Write-Host "unique count: $($manifest.uniqueProducts)"
Write-Host "page count: $($manifest.successfulPages)"
Write-Host "duration: $duration seconds"
