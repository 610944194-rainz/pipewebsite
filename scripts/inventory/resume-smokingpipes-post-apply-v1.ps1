param(
  [Parameter(Mandatory = $true)]
  [string]$AutomationWorktree,
  [Parameter(Mandatory = $true)]
  [string]$BuildExecutable,
  [switch]$PreflightOnly,
  [ValidateRange(1, 100000)]
  [int]$ExpectedAppliedCount = 895
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ReportJsonPath = Join-Path $ProjectRoot "data\review\smokingpipes-post-apply-recovery-latest.json"
$ReportMarkdownPath = Join-Path $ProjectRoot "data\review\smokingpipes-post-apply-recovery-latest.md"
$AutoPublishReportPath = Join-Path $ProjectRoot "data\review\smokingpipes-auto-publish-latest.json"
$DailyTaskStatePath = Join-Path $ProjectRoot "data\inventory\smokingpipes-daily-task-state.json"
$ProgressiveStatePath = Join-Path $ProjectRoot "data\inventory\smokingpipes-progressive-daily-state.json"
$AuditScriptPath = Join-Path $ProjectRoot "scripts\inventory\smokingpipes-post-apply-recovery-audit-v1.mjs"
$PublicValidatorPath = Join-Path $ProjectRoot "scripts\validate-public-product-indexes-v1.mjs"
$InventoryValidatorPath = Join-Path $ProjectRoot "scripts\test-public-products-inventory-default-v1.mjs"
$ProductionPaths = @(
  "data/products/smokingpipes-products.json",
  "data/products/unified-products-staging.json"
)

function Invoke-GitChecked { param([string[]]$Arguments)
  $priorErrorAction = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { $output = @(& git -C $ProjectRoot @Arguments 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $priorErrorAction }
  if ($exitCode -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
  return ($output -join [Environment]::NewLine).Trim()
}

function Invoke-CheckedCommand { param([string]$FilePath, [string[]]$Arguments, [string]$Stage)
  if ([string]::IsNullOrWhiteSpace($FilePath)) { throw "$Stage executable path is not initialized" }
  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw "$Stage executable is missing: $FilePath" }
  $priorErrorAction = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { $output = @(& $FilePath @Arguments 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $priorErrorAction }
  if ($exitCode -ne 0) { throw "$Stage failed with exit code ${exitCode}: $($output -join [Environment]::NewLine)" }
  return ($output -join [Environment]::NewLine)
}

function Read-RequiredJson { param([string]$PathToRead, [string]$Description)
  if ([string]::IsNullOrWhiteSpace($PathToRead)) { throw "$Description path is not initialized" }
  if (-not (Test-Path -LiteralPath $PathToRead -PathType Leaf)) { throw "$Description is missing: $PathToRead" }
  return (Get-Content -LiteralPath $PathToRead -Raw -Encoding utf8 | ConvertFrom-Json)
}

function Test-AllowedProductionPath { param([string]$PathToCheck)
  $value = $PathToCheck.Replace("\", "/")
  return $value -eq $ProductionPaths[0] -or $value -eq $ProductionPaths[1] -or $value.StartsWith("data/generated/public-products/")
}

function Get-DiagnosticSnapshot {
  $safeParameters = [ordered]@{}
  foreach ($entry in $PSBoundParameters.GetEnumerator()) {
    $safeParameters[$entry.Key] = if ($entry.Key -match "(?i)(secret|token|password|key)") { "[redacted]" } else { [string]$entry.Value }
  }
  return [ordered]@{ psBoundParameters = $safeParameters; buildExecutable = $BuildExecutable; projectRoot = $ProjectRoot }
}

$report = [ordered]@{
  runId = "smokingpipes-post-apply-recovery-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  startedAt = (Get-Date).ToString("o"); completedAt = $null; status = "running"; failureStage = $null; failureReason = $null
  expectedAppliedCount = $ExpectedAppliedCount; productionWritten = $false; appliedCount = 0
  buildExecutableRequested = $BuildExecutable; buildExecutableResolved = $null; buildExecutableResolutionMode = "explicit-absolute"
  validatorPassed = $false; inventoryDefaultPassed = $false; buildPassed = $false; postApplyAuditPassed = $false
  changedProductionFiles = @(); stagedFiles = @(); commitPerformed = $false; commitSha = $null; pushPerformed = $false
  pushTarget = "origin HEAD:main"; finalAutoPublishReportWritten = $false
  deploymentStatus = "not-started"; diagnostic = Get-DiagnosticSnapshot
}

function Write-RecoveryReport { param([string]$Status, [string]$Stage = $null, [string]$Reason = $null)
  $report.status = $Status; $report.failureStage = $Stage; $report.failureReason = $Reason; $report.completedAt = (Get-Date).ToString("o")
  New-Item -ItemType Directory -Force -Path (Split-Path $ReportJsonPath) | Out-Null
  Write-JsonAtomically -Path $ReportJsonPath -Value $report
  $markdown = @("# Smokingpipes Post-Apply Recovery", "", "- status: $($report.status)", "- productionWritten: $($report.productionWritten)", "- appliedCount: $($report.appliedCount)", "- buildExecutableRequested: $($report.buildExecutableRequested)", "- buildExecutableResolved: $($report.buildExecutableResolved)", "- buildPassed: $($report.buildPassed)", "- commitPerformed: $($report.commitPerformed)", "- pushPerformed: $($report.pushPerformed)", "- failureStage: $($report.failureStage)", "- failureReason: $($report.failureReason)") -join "`n"
  [IO.File]::WriteAllText($ReportMarkdownPath, "`uFEFF$markdown`n", [Text.UTF8Encoding]::new($true))
}

function Write-JsonAtomically { param([string]$Path, [object]$Value)
  $directory = Split-Path $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + "." + [guid]::NewGuid().ToString("N") + ".tmp")
  try { [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 10) + "`n"), [Text.UTF8Encoding]::new($false)); Move-Item -LiteralPath $temporary -Destination $Path -Force } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Write-FinalAutoPublishReport {
  $final = [ordered]@{ status="success"; productionWritten=$true; appliedCount=$report.appliedCount; validatorPassed=$report.validatorPassed; buildPassed=$report.buildPassed; buildExecutableRequested=$report.buildExecutableRequested; buildExecutableResolved=$report.buildExecutableResolved; buildExecutableResolutionMode=$report.buildExecutableResolutionMode; commitPerformed=$true; commitSha=$report.commitSha; pushPerformed=$true; pushTarget=$report.pushTarget; deploymentStatus="pending-verification"; failureStage=$null; failureReason=$null; completedAt=(Get-Date).ToString("o") }
  Write-JsonAtomically -Path $AutoPublishReportPath -Value $final
  $report.finalAutoPublishReportWritten = $true
}

function Stop-Recovery { param([string]$Stage, [string]$Reason)
  Write-RecoveryReport -Status "failed" -Stage $Stage -Reason $Reason
  throw $Reason
}

try {
  $report.failureStage = "recovery-state-validation"
  if (-not [IO.Path]::IsPathRooted($BuildExecutable) -or -not (Test-Path -LiteralPath $BuildExecutable -PathType Leaf)) { Stop-Recovery -Stage "executable-resolution" -Reason "BuildExecutable must be an existing absolute leaf path" }
  $report.buildExecutableResolved = (Resolve-Path -LiteralPath $BuildExecutable).Path
  if ([IO.Path]::GetFullPath($AutomationWorktree).TrimEnd("\") -ne [IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\")) { Stop-Recovery -Stage "recovery-state-validation" -Reason "AutomationWorktree must equal this recovery script worktree" }
  foreach ($item in @(@{p=$AutoPublishReportPath;n="auto-publish report"}, @{p=$DailyTaskStatePath;n="daily task state"}, @{p=$ProgressiveStatePath;n="progressive daily state"}, @{p=$AuditScriptPath;n="post-apply audit"})) {
    if (-not (Test-Path -LiteralPath $item.p -PathType Leaf)) { Stop-Recovery -Stage "recovery-state-validation" -Reason "$($item.n) is missing: $($item.p)" }
  }
  $previous = Read-RequiredJson $AutoPublishReportPath "auto-publish report"; $daily = Read-RequiredJson $DailyTaskStatePath "daily task state"; $progressive = Read-RequiredJson $ProgressiveStatePath "progressive daily state"
  $pending = @($progressive.candidates | Where-Object { $_.detailStatus -eq "pending" }).Count; $failed = @($progressive.candidates | Where-Object { $_.detailStatus -eq "failed" }).Count
  $blockers = @()
  if ($previous.productionWritten -ne $true -or $daily.productionWritten -ne $true) { $blockers += "productionWritten must be true" }
  if ([int]$previous.appliedCount -ne $ExpectedAppliedCount -or [int]$daily.appliedCount -ne $ExpectedAppliedCount) { $blockers += "appliedCount must equal $ExpectedAppliedCount" }
  if ($previous.commitPerformed -eq $true -or $previous.pushPerformed -eq $true) { $blockers += "auto-publish report already committed or pushed" }
  if ($pending -ne 0 -or $failed -ne 0) { $blockers += "pending=$pending failed=$failed" }
  if ($progressive.fullExpectedRangeScanned -ne $true) { $blockers += "list fullExpectedRangeScanned must be true" }
  Invoke-GitChecked @("fetch", "origin") | Out-Null
  $head = Invoke-GitChecked @("rev-parse", "HEAD"); $origin = Invoke-GitChecked @("rev-parse", "origin/main"); $branch = Invoke-GitChecked @("branch", "--show-current"); $upstream = Invoke-GitChecked @("rev-parse", "--abbrev-ref", "@{u}")
  if ($head -ne $origin) { $blockers += "HEAD does not match origin/main" }; if ($branch -notlike "automation/*" -or $upstream -ne "origin/main") { $blockers += "branch/upstream must be automation/* tracking origin/main" }
  $changed = @(& git -C $ProjectRoot diff --name-only) | Where-Object { $_ }; $disallowed = @($changed | Where-Object { -not (Test-AllowedProductionPath $_) })
  if ($changed.Count -eq 0) { $blockers += "production dirty files are required" }; if ($disallowed.Count) { $blockers += "non-production dirty files: $($disallowed -join ', ')" }; if (@(& git -C $ProjectRoot diff --cached --name-only).Count) { $blockers += "pre-staged files are not allowed" }
  if ($blockers.Count) { Stop-Recovery -Stage "recovery-state-validation" -Reason ($blockers -join "; ") }
  $report.productionWritten = $true; $report.appliedCount = $ExpectedAppliedCount; $report.changedProductionFiles = @($changed); $report.failureStage = $null
  if ($PreflightOnly) { $report.deploymentStatus = "not-requested"; Write-RecoveryReport -Status "preflight-passed"; exit 0 }
  $report.failureStage = "diff-guard"; Invoke-CheckedCommand (Get-Command node -CommandType Application -ErrorAction Stop).Source @($AuditScriptPath, "--root=$ProjectRoot", "--expected-applied-count=$ExpectedAppliedCount") "post-apply-audit" | Out-Null; $report.postApplyAuditPassed = $true
  $report.failureStage = "validator"; $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source; Invoke-CheckedCommand $node @($PublicValidatorPath) "validator" | Out-Null; $report.validatorPassed = $true; Invoke-CheckedCommand $node @($InventoryValidatorPath) "inventory-default-validator" | Out-Null; $report.inventoryDefaultPassed = $true
  $report.failureStage = "build"; Invoke-CheckedCommand $report.buildExecutableResolved @("--cache", (Join-Path $env:TEMP "yandoubuy-npm-cache"), "run", "build") "build" | Out-Null; $report.buildPassed = $true
  $report.failureStage = "diff-guard"; Invoke-GitChecked @("diff", "--check") | Out-Null; $changed = @(& git -C $ProjectRoot diff --name-only) | Where-Object { $_ }; if (($changed | Where-Object { -not (Test-AllowedProductionPath $_) }).Count) { Stop-Recovery -Stage "diff-guard" -Reason "non-production dirty files appeared after build" }
  $report.failureStage = "stage"; foreach ($file in $changed) { Invoke-GitChecked @("add", "--", $file) | Out-Null }; $report.stagedFiles = @(& git -C $ProjectRoot diff --cached --name-only) | Where-Object { $_ }; if ($report.stagedFiles.Count -ne $changed.Count) { Stop-Recovery -Stage "stage" -Reason "staged file count does not match production diff" }
  $report.failureStage = "commit"; Invoke-GitChecked @("commit", "-m", "chore: publish Smokingpipes daily update $(Get-Date -Format yyyyMMdd)") | Out-Null; $report.commitPerformed = $true; $report.commitSha = Invoke-GitChecked @("rev-parse", "HEAD")
  $report.failureStage = "push"; Invoke-GitChecked @("push", "origin", "HEAD:main") | Out-Null; $report.pushPerformed = $true; $report.deploymentStatus = "pending-verification"; $report.failureStage = $null
  try { Write-FinalAutoPublishReport } catch { $report.failureStage = "final-report"; $report.failureReason = $_.Exception.Message; Write-RecoveryReport -Status "push-complete-final-report-failed" -Stage "final-report" -Reason $_.Exception.Message; throw }
  Write-RecoveryReport -Status "success"
} catch {
  $exception = $_
  $reason = $exception.Exception.Message
  $report.diagnostic.exceptionType = $exception.Exception.GetType().FullName
  $report.diagnostic.scriptStackTrace = $exception.ScriptStackTrace
  $report.diagnostic.positionMessage = $exception.InvocationInfo.PositionMessage
  $report.diagnostic.myCommand = [string]$exception.InvocationInfo.MyCommand
  $report.diagnostic.scriptLineNumber = $exception.InvocationInfo.ScriptLineNumber
  if (-not $report.completedAt) { Write-RecoveryReport -Status "failed" -Stage $(if ($report.failureStage) { $report.failureStage } else { "unexpected" }) -Reason $reason }
  Write-Error $reason; exit 1
}
