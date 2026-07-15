[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$RunId,

    [string]$Worktree = 'C:\Users\NING MEI\Desktop\pipewebsite-danish-full-refresh-prep',

    [ValidateRange(1, 100000)]
    [int]$TargetCount = 5000,

    [ValidateRange(1, 1000)]
    [int]$MaxLoadMoreClicks = 100,

    [ValidateRange(500, 60000)]
    [int]$LoadMoreDelayMs = 4000,

    [ValidateRange(0, 10)]
    [int]$ShowMoreRetries = 2,

    [ValidateRange(1, 100000)]
    [int]$MinimumExpectedCount = 1000
)

$ErrorActionPreference = 'Stop'

$Node = 'C:\Program Files\nodejs\node.exe'
$Collector = Join-Path $Worktree 'scripts\collect-danish-full-v18.mjs'
$DetailDependency = Join-Path $Worktree 'scripts\collect-danish-details-v16.mjs'

$RunDirectory = Join-Path $Worktree "data\raw\danish-full-refresh\$RunId"
$ListOutput = Join-Path $RunDirectory 'list.json'
$DetailsOutput = Join-Path $RunDirectory 'details.json'
$ErrorsOutput = Join-Path $RunDirectory 'detail-errors.json'
$BrowserProfile = Join-Path $Worktree 'data\runtime\danish-browser-profile'

if (-not (Test-Path -LiteralPath $Worktree -PathType Container)) {
    throw "Worktree not found: $Worktree"
}

if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) {
    throw "Node executable not found: $Node"
}

if (-not (Test-Path -LiteralPath $Collector -PathType Leaf)) {
    throw "V18 collector not found: $Collector"
}

if (-not (Test-Path -LiteralPath $DetailDependency -PathType Leaf)) {
    throw "V16 detail dependency not found: $DetailDependency"
}

if (Test-Path -LiteralPath $ListOutput -PathType Leaf) {
    throw "RunId already has list.json. Use a new RunId: $ListOutput"
}

New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $BrowserProfile -Force | Out-Null

Set-Location $Worktree

Write-Host ''
Write-Host '=== Danish V18 preflight ===' -ForegroundColor Cyan

& $Node --check $Collector

if ($LASTEXITCODE -ne 0) {
    throw "V18 syntax check failed: $LASTEXITCODE"
}

& $Node -e "import('playwright').then(()=>console.log('[PASS] Playwright import')).catch(e=>{console.error(e);process.exit(1)})"

if ($LASTEXITCODE -ne 0) {
    throw "Playwright import failed. Run npm.cmd ci in this worktree."
}

$env:DANISH_MODE = 'list'
$env:DANISH_START_URL = 'https://www.danishpipeshop.com/l/-zh/Pipes1'
$env:DANISH_TARGET_COUNT = [string]$TargetCount
$env:DANISH_MAX_LIST_PAGES = '20'
$env:DANISH_MAX_LOAD_MORE_CLICKS = [string]$MaxLoadMoreClicks
$env:DANISH_LOAD_MORE_DELAY_MS = [string]$LoadMoreDelayMs
$env:DANISH_SHOW_MORE_RETRIES = [string]$ShowMoreRetries
$env:DANISH_PAGE_READY_TIMEOUT_MS = '90000'
$env:DANISH_LANGUAGE_FALLBACK_SECONDS = '20'
$env:DANISH_MIN_EXPECTED_COUNT = [string]$MinimumExpectedCount

$env:DANISH_LIST_OUTPUT = $ListOutput
$env:DANISH_OUTPUT = $DetailsOutput
$env:DANISH_ERRORS_OUTPUT = $ErrorsOutput
$env:DANISH_BROWSER_PROFILE = $BrowserProfile
$env:DANISH_SAVE_SCREENSHOTS = '1'
$env:DANISH_CHECKPOINT_EVERY = '10'

Write-Host ''
Write-Host '=== Danish V18 List collection ===' -ForegroundColor Cyan
Write-Host "RunId: $RunId"
Write-Host "Collector: $Collector"
Write-Host "List output: $ListOutput"
Write-Host "Browser profile: $BrowserProfile"
Write-Host "Target count: $TargetCount"
Write-Host "Minimum expected count: $MinimumExpectedCount"
Write-Host "Maximum Show-more clicks: $MaxLoadMoreClicks"
Write-Host ''
Write-Host 'Browser procedure:' -ForegroundColor Yellow
Write-Host '1. Complete the robot verification in Chrome.'
Write-Host '2. Return to PowerShell and press Enter when prompted.'
Write-Host '3. The collector will automatically select the language.'
Write-Host '4. Do not close Chrome while collection is running.'
Write-Host ''

& $Node $Collector

$CollectorExitCode = $LASTEXITCODE

Write-Host ''
Write-Host "Collector exit code: $CollectorExitCode"

if ($CollectorExitCode -ne 0) {
    throw "Danish V18 collector failed: $CollectorExitCode"
}

if (-not (Test-Path -LiteralPath $ListOutput -PathType Leaf)) {
    throw "Collector returned success but list.json was not created: $ListOutput"
}

$Payload = Get-Content -LiteralPath $ListOutput -Raw -Encoding UTF8 |
    ConvertFrom-Json

$Summary = [pscustomobject]@{
    CollectorVersion     = $Payload.collectorVersion
    TotalCount           = $Payload.totalCount
    DedupedCount         = $Payload.dedupedCount
    InvalidLinkCount     = $Payload.invalidLinkCount
    InitialShownCount    = $Payload.initialShownCount
    DetectedTotalCount   = $Payload.detectedTotalCount
    ShowMoreClickCount   = $Payload.showMoreClickCount
    FinalShownCount      = $Payload.finalShownCount
    FinalUniqueCount     = $Payload.finalUniqueCount
    CompletionReason     = $Payload.completionReason
    ListTotalMatched     = $Payload.listTotalMatched
    MinimumCountPassed   = $Payload.minimumCountPassed
    IntegrityGate        = $Payload.integrityGate
    IntegrityFailure     = $Payload.integrityFailureReason
    Output               = $ListOutput
}

Write-Host ''
Write-Host '=== Danish V18 List Summary ===' -ForegroundColor Cyan
$Summary | Format-List

if (-not [bool]$Payload.integrityGate) {
    throw "List integrity gate failed: $($Payload.integrityFailureReason)"
}

if ([int]$Payload.totalCount -ne [int]$Payload.dedupedCount) {
    throw "Duplicate products detected."
}

if ([int]$Payload.invalidLinkCount -ne 0) {
    throw "Invalid product links detected: $($Payload.invalidLinkCount)"
}

if ([int]$Payload.totalCount -lt $MinimumExpectedCount) {
    throw "Product count is below the safety minimum."
}

if (
    [int]$Payload.detectedTotalCount -gt 0 -and
    [int]$Payload.totalCount -lt [int]$Payload.detectedTotalCount
) {
    throw "Collected count is below the detected website total."
}

Write-Host ''
Write-Host '[PASS] Danish V18 complete list passed integrity checks.' -ForegroundColor Green
Write-Host "List path: $ListOutput" -ForegroundColor Green