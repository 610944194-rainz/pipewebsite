$ErrorActionPreference = "Stop"

$ProjectRoot = "C:\Users\NING MEI\Desktop\pipewebsite"
$LogPath = Join-Path $ProjectRoot "data\review\smokingpipes-daily-task-latest.log"
$EnvPath = Join-Path $ProjectRoot ".env.inventory.local"
$AuditPath = Join-Path $ProjectRoot "data\review\smokingpipes-progressive-partial-audit-report.json"
$CurrentListPath = "data/inventory/smokingpipes-current-list-dry-run.json"
$DiffPath = "data/inventory/smokingpipes-inventory-diff-dry-run.json"

Set-Location $ProjectRoot
New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null

function Write-DailyLog {
  param([string]$Message)
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Import-InventoryEnv {
  if (-not (Test-Path $EnvPath)) {
    Write-DailyLog "env file not found: $EnvPath"
    return
  }

  foreach ($line in Get-Content -Path $EnvPath -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }

    $index = $trimmed.IndexOf("=")
    $name = $trimmed.Substring(0, $index).Trim()
    $value = $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")

    if ($name) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Invoke-InventoryNode {
  param(
    [string]$StepName,
    [string[]]$Arguments,
    [switch]$ContinueOnFailure
  )

  Write-DailyLog "START $StepName"
  Add-Content -Path $LogPath -Value ("node " + ($Arguments -join " ")) -Encoding UTF8
  & node @Arguments 2>&1 | Tee-Object -FilePath $LogPath -Append
  $exitCode = $LASTEXITCODE
  Write-DailyLog "EXIT $StepName $exitCode"

  if ($exitCode -ne 0 -and -not $ContinueOnFailure) {
    throw "$StepName failed with exit code $exitCode"
  }

  return $exitCode
}

function Test-AuditAllowsProductionWrite {
  if (-not (Test-Path $AuditPath)) {
    Write-DailyLog "audit missing; production write blocked"
    return $false
  }

  $audit = Get-Content -Path $AuditPath -Encoding UTF8 | ConvertFrom-Json
  $auditStatus = if ($audit.auditStatus) { $audit.auditStatus } elseif ($audit.verdict) { $audit.verdict } else { "" }
  $counts = if ($audit.counts) { $audit.counts } else { [pscustomobject]@{} }
  $blockers = @($audit.blockers)
  $candidateCount = [int]($audit.candidateCount)
  $wouldApplyCount = [int]($audit.wouldApplyCount)
  $deletedProducts = [int]($counts.deletedProducts)
  $pendingLeak = [int]($counts.pendingLeak)
  $failedLeak = [int]($counts.failedLeak)
  $blockedLeak = [int]($counts.blockedLeak)
  $reviewOnlyLeak = [int]($counts.reviewOnlyLeak)
  $zeroPriceSellable = [int]($counts.zeroPriceSellable)

  $allowed =
    $auditStatus -eq "PASS" -and
    $candidateCount -eq $wouldApplyCount -and
    $candidateCount -gt 0 -and
    $deletedProducts -eq 0 -and
    $pendingLeak -eq 0 -and
    $failedLeak -eq 0 -and
    $blockedLeak -eq 0 -and
    $reviewOnlyLeak -eq 0 -and
    $zeroPriceSellable -eq 0 -and
    $blockers.Count -eq 0

  Write-DailyLog "auditStatus=$auditStatus candidateCount=$candidateCount wouldApplyCount=$wouldApplyCount applyAllowed=$allowed"
  return $allowed
}

function Send-MobileReport {
  Invoke-InventoryNode -StepName "mobile-report" -Arguments @(
    "scripts/inventory/smokingpipes-daily-mobile-report-v1.mjs",
    "--send"
  ) -ContinueOnFailure | Out-Null
}

Set-Content -Path $LogPath -Value "=== SMOKINGPIPES PROGRESSIVE DAILY START $(Get-Date -Format o) ===" -Encoding UTF8

try {
  Import-InventoryEnv

  Invoke-InventoryNode -StepName "current-list" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=dry-run",
    "--max-pages=107",
    "--allow-manual-verification=true",
    "--browser-channel=chrome",
    "--browser-profile=sp-chrome",
    "--skip-new-details",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  )

  Invoke-InventoryNode -StepName "progressive-ingest-list" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=progressive-ingest-list",
    "--current-list=$CurrentListPath",
    "--diff=$DiffPath",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  )

  $detailExit = Invoke-InventoryNode -StepName "progressive-detail-chunk" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=progressive-detail-chunk",
    "--progressive-detail-max=30",
    "--browser-channel=chrome",
    "--browser-profile=sp-chrome",
    "--allow-manual-verification=true",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  ) -ContinueOnFailure

  if ($detailExit -ne 0) {
    Write-DailyLog "detail chunk blocked or failed; production write skipped"
    Send-MobileReport
    exit $detailExit
  }

  Invoke-InventoryNode -StepName "progressive-build-candidate" -Arguments @(
    "scripts/inventory/run-inventory-automation-v1.mjs",
    "--source=smokingpipes",
    "--mode=progressive-build-candidate",
    "--no-commit",
    "--no-deploy",
    "--verbose"
  )

  if (Test-AuditAllowsProductionWrite) {
    Invoke-InventoryNode -StepName "progressive-partial-apply" -Arguments @(
      "scripts/inventory/run-inventory-automation-v1.mjs",
      "--source=smokingpipes",
      "--mode=progressive-partial-apply",
      "--write-production",
      "--no-commit",
      "--no-deploy",
      "--verbose"
    )
  } else {
    Write-DailyLog "audit gate blocked production write"
  }

  Send-MobileReport
  Write-DailyLog "DAILY TASK COMPLETE"
} catch {
  Write-DailyLog "DAILY TASK FAILED: $($_.Exception.Message)"
  Send-MobileReport
  exit 1
} finally {
  Write-DailyLog "=== SMOKINGPIPES PROGRESSIVE DAILY EXIT $(Get-Date -Format o) ==="
}
