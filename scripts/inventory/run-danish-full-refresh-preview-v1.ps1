[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AutomationWorktree,
  [Parameter(Mandatory = $true)][string]$RunId,
  [switch]$ListOnly,
  [switch]$Resume,
  [int]$DetailChunkSize = 30,
  [int]$MaxDetailItems = 30,
  [switch]$SkipExistingCompleteDetails,
  [switch]$ReportOnly
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($AutomationWorktree)
$scriptPath = Join-Path $root 'scripts\inventory\danish-full-refresh-preview-v1.mjs'
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Preview core not found: $scriptPath" }
if ($DetailChunkSize -lt 1 -or $MaxDetailItems -lt 1) { throw 'DetailChunkSize and MaxDetailItems must be positive.' }
$effectiveMaxDetailItems = if ($PSBoundParameters.ContainsKey('MaxDetailItems')) { $MaxDetailItems } else { $DetailChunkSize }

if ($ReportOnly) {
  $runRoot = Join-Path $root (Join-Path 'data\raw\danish-full-refresh' $RunId)
  $reviewRoot = Join-Path $root (Join-Path 'data\review\danish-full-refresh' $RunId)
  $manifestPath = Join-Path $runRoot 'manifest.json'
  $diffPath = Join-Path $reviewRoot 'diff-preview.json'
  if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $diffPath)) { throw "Run report not found for RunId: $RunId" }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $diff = Get-Content -Raw -LiteralPath $diffPath | ConvertFrom-Json
  [pscustomobject]@{
    RunId = $manifest.runId; TotalPages = $manifest.expectedPages; SuccessfulPages = $manifest.successfulPages; FailedPages = $manifest.failedPages
    UniqueProducts = $manifest.uniqueProducts; Available = $manifest.available; Sold = $manifest.sold; Unknown = $manifest.unknown; Blocked = $manifest.blocked
    DetailSuccess = $manifest.detailSuccess; DetailFailed = $manifest.detailFailed; Pending = $manifest.pending
    New = $diff.counts.new; SoldCandidates = $diff.counts.'available-to-sold'; Restocked = $diff.counts.'sold-to-available'; PriceChanges = $diff.counts.'price-change'
    Missing = $diff.counts.'missing-from-current-list'; ExpectedChanges = $diff.expectedChangeCount; IntegrityGate = $diff.integrityGate.complete
  } | Format-List
  exit 0
}

$arguments = @($scriptPath, '--automation-worktree', $root, '--run-id', $RunId, '--max-detail-items', [string]$effectiveMaxDetailItems)
if ($ListOnly) { $arguments += '--list-only' }
if ($Resume) { $arguments += '--resume' }
if ($SkipExistingCompleteDetails) { $arguments += '--skip-existing-complete-details' }
if ($ReportOnly) { $arguments += '--report' }

# The Node core writes only data/raw|audits|review/danish-full-refresh/<RunId>.
# It contains no Production/Public writer, git command, scheduler call, or Apply switch.
& node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
