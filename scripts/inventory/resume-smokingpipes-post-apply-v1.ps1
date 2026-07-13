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
$ReportNormalJsonBytes = 256KB
$ReportNormalMarkdownBytes = 128KB
$ReportHardLimitBytes = 2MB
$ReportOutputTailChars = 32768
$ReportStackTraceChars = 8192
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

function Get-TextTail { param([AllowNull()][string]$Text, [int]$MaximumCharacters = $ReportOutputTailChars)
  if ([string]::IsNullOrEmpty($Text) -or $Text.Length -le $MaximumCharacters) { return $Text }
  return "[truncated; originalChars=$($Text.Length)]`n" + $Text.Substring($Text.Length - $MaximumCharacters)
}

function Get-FileTextTail { param([string]$PathToRead, [int]$MaximumCharacters = $ReportOutputTailChars)
  if (-not (Test-Path -LiteralPath $PathToRead -PathType Leaf)) { return $null }
  $item = Get-Item -LiteralPath $PathToRead
  $bytesToRead = [Math]::Min([int64]($MaximumCharacters * 4), $item.Length)
  $buffer = New-Object byte[] $bytesToRead
  $stream = [IO.File]::Open($PathToRead, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    if ($item.Length -gt $bytesToRead) { [void]$stream.Seek(-$bytesToRead, [IO.SeekOrigin]::End) }
    [void]$stream.Read($buffer, 0, $buffer.Length)
  } finally { $stream.Dispose() }
  return Get-TextTail -Text ([Text.Encoding]::UTF8.GetString($buffer)) -MaximumCharacters $MaximumCharacters
}

function Invoke-GitDiffCheck {
  $temporary = Join-Path $env:TEMP ("smokingpipes-git-diff-check-" + [guid]::NewGuid().ToString("N") + ".log")
  $priorErrorAction = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try {
    & git -C $ProjectRoot diff --check *> $temporary
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $priorErrorAction }
  try {
    $report.exitCodes["diff-guard"] = $exitCode
    if ($exitCode -ne 0) {
      $tail = Get-FileTextTail -PathToRead $temporary
      $report.stderrTail = $tail
      throw "git diff --check failed with exit code ${exitCode}: $tail"
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
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

$report = [ordered]@{
  runId = "smokingpipes-post-apply-recovery-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  startedAt = (Get-Date).ToString("o"); completedAt = $null; status = "running"; failureStage = $null; failureReason = $null
  expectedAppliedCount = $ExpectedAppliedCount; productionWritten = $false; appliedCount = 0
  buildExecutableRequested = $BuildExecutable; buildExecutableResolved = $null; buildExecutableResolutionMode = "explicit-absolute"
  validatorPassed = $false; inventoryDefaultPassed = $false; buildPassed = $false; postApplyAuditPassed = $false
  changedProductionFiles = @(); stagedFiles = @(); commitPerformed = $false; commitSha = $null; pushPerformed = $false
  pushTarget = "origin HEAD:main"; finalAutoPublishReportWritten = $false
  deploymentStatus = "not-started"; failureType = $null; stdoutTail = $null; stderrTail = $null; scriptStackTrace = $null
  durations = [ordered]@{}; exitCodes = [ordered]@{}; touchedUniqueIds = $null; auditSummary = [ordered]@{}
}

function Get-RecoveryReportDto {
  return [ordered]@{
    status = $report.status; startedAt = $report.startedAt; completedAt = $report.completedAt; currentStage = $report.failureStage
    expectedAppliedCount = $report.expectedAppliedCount; appliedCount = $report.appliedCount; productionWritten = $report.productionWritten
    validatorPassed = $report.validatorPassed; buildPassed = $report.buildPassed
    buildExecutableRequested = $report.buildExecutableRequested; buildExecutableResolved = $report.buildExecutableResolved; buildExecutableResolutionMode = $report.buildExecutableResolutionMode
    stagedFileCount = @($report.stagedFiles).Count; commitPerformed = $report.commitPerformed; commitSha = $report.commitSha
    pushPerformed = $report.pushPerformed; pushTarget = $report.pushTarget; deploymentStatus = $report.deploymentStatus
    failureStage = $report.failureStage; failureReason = Get-TextTail -Text $report.failureReason -MaximumCharacters $ReportOutputTailChars; failureType = $report.failureType
    durations = $report.durations; exitCodes = $report.exitCodes
    stdoutTail = Get-TextTail -Text $report.stdoutTail -MaximumCharacters $ReportOutputTailChars
    stderrTail = Get-TextTail -Text $report.stderrTail -MaximumCharacters $ReportOutputTailChars
    scriptStackTrace = Get-TextTail -Text $report.scriptStackTrace -MaximumCharacters $ReportStackTraceChars
    changedFileCount = @($report.changedProductionFiles).Count; touchedUniqueIds = $report.touchedUniqueIds; auditSummary = $report.auditSummary
  }
}

function ConvertTo-ReportJson { param([object]$Value)
  $json = ($Value | ConvertTo-Json -Depth 6) + "`n"
  [void](ConvertFrom-Json -InputObject $json -ErrorAction Stop)
  return $json
}

function Write-TextAtomically { param([string]$Path, [string]$Text)
  $directory = Split-Path $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + "." + [guid]::NewGuid().ToString("N") + ".tmp")
  try { [IO.File]::WriteAllText($temporary, $Text, [Text.UTF8Encoding]::new($false)); Move-Item -LiteralPath $temporary -Destination $Path -Force } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Write-EmergencyReport { param([int64]$EstimatedBytes, [string]$Which)
  $emergency = [ordered]@{ status = "report-size-blocked"; estimatedBytes = $EstimatedBytes; report = $Which; generatedAt = (Get-Date).ToString("o") }
  $emergencyJson = ConvertTo-ReportJson $emergency
  $emergencyPath = Join-Path (Split-Path $ReportJsonPath) "smokingpipes-post-apply-recovery-emergency.json"
  Write-TextAtomically -Path $emergencyPath -Text $emergencyJson
}

function Assert-ReportSize { param([string]$Text, [string]$Which, [int64]$NormalBytes)
  $byteCount = [Text.UTF8Encoding]::new($false).GetByteCount($Text)
  if ($byteCount -gt $ReportHardLimitBytes) {
    Write-EmergencyReport -EstimatedBytes $byteCount -Which $Which
    throw "$Which report exceeds hard limit of $ReportHardLimitBytes bytes (estimatedBytes=$byteCount)"
  }
  if ($byteCount -gt $NormalBytes) { Write-Warning "$Which report exceeds normal target of $NormalBytes bytes (actualBytes=$byteCount)" }
  return $byteCount
}

function ConvertTo-RecoveryMarkdown { param([object]$Dto)
  return @("# Smokingpipes Post-Apply Recovery", "", "- status: $($Dto.status)", "- productionWritten: $($Dto.productionWritten)", "- appliedCount: $($Dto.appliedCount)", "- validatorPassed: $($Dto.validatorPassed)", "- buildPassed: $($Dto.buildPassed)", "- buildExecutableRequested: $($Dto.buildExecutableRequested)", "- buildExecutableResolved: $($Dto.buildExecutableResolved)", "- commitPerformed: $($Dto.commitPerformed)", "- commitSha: $($Dto.commitSha)", "- pushPerformed: $($Dto.pushPerformed)", "- pushTarget: $($Dto.pushTarget)", "- deploymentStatus: $($Dto.deploymentStatus)", "- failureStage: $($Dto.failureStage)", "- failureReason: $($Dto.failureReason)") -join "`n"
}

function Write-RecoveryReport { param([string]$Status, [string]$Stage = $null, [string]$Reason = $null)
  $report.status = $Status; $report.failureStage = $Stage; $report.failureReason = Get-TextTail -Text $Reason -MaximumCharacters $ReportOutputTailChars; $report.completedAt = (Get-Date).ToString("o")
  $dto = Get-RecoveryReportDto; $json = ConvertTo-ReportJson $dto; $markdown = (ConvertTo-RecoveryMarkdown $dto) + "`n"
  [void](Assert-ReportSize -Text $json -Which "JSON" -NormalBytes $ReportNormalJsonBytes)
  [void](Assert-ReportSize -Text $markdown -Which "Markdown" -NormalBytes $ReportNormalMarkdownBytes)
  Write-TextAtomically -Path $ReportJsonPath -Text $json
  Write-TextAtomically -Path $ReportMarkdownPath -Text $markdown
}

function Write-FinalAutoPublishReport {
  $final = [ordered]@{ status="success"; completedAt=(Get-Date).ToString("o"); expectedAppliedCount=$report.expectedAppliedCount; appliedCount=$report.appliedCount; productionWritten=$true; validatorPassed=$report.validatorPassed; buildPassed=$report.buildPassed; buildExecutableRequested=$report.buildExecutableRequested; buildExecutableResolved=$report.buildExecutableResolved; buildExecutableResolutionMode=$report.buildExecutableResolutionMode; commitPerformed=$true; commitSha=$report.commitSha; pushPerformed=$true; pushTarget=$report.pushTarget; deploymentStatus="pending-verification"; failureStage=$null; failureReason=$null; failureType=$null }
  $json = ConvertTo-ReportJson $final
  [void](Assert-ReportSize -Text $json -Which "auto-publish JSON" -NormalBytes $ReportNormalJsonBytes)
  Write-TextAtomically -Path $AutoPublishReportPath -Text $json
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
  $report.failureStage = "diff-guard"; Invoke-GitDiffCheck; $changed = @(& git -C $ProjectRoot diff --name-only) | Where-Object { $_ }; if (($changed | Where-Object { -not (Test-AllowedProductionPath $_) }).Count) { Stop-Recovery -Stage "diff-guard" -Reason "non-production dirty files appeared after build" }
  $report.failureStage = "stage"; foreach ($file in $changed) { Invoke-GitChecked @("add", "--", $file) | Out-Null }; $report.stagedFiles = @(& git -C $ProjectRoot diff --cached --name-only) | Where-Object { $_ }; if ($report.stagedFiles.Count -ne $changed.Count) { Stop-Recovery -Stage "stage" -Reason "staged file count does not match production diff" }
  $report.failureStage = "commit"; Invoke-GitChecked @("commit", "-m", "chore: publish Smokingpipes daily update $(Get-Date -Format yyyyMMdd)") | Out-Null; $report.commitPerformed = $true; $report.commitSha = Invoke-GitChecked @("rev-parse", "HEAD")
  $report.failureStage = "push"; Invoke-GitChecked @("push", "origin", "HEAD:main") | Out-Null; $report.pushPerformed = $true; $report.deploymentStatus = "pending-verification"; $report.failureStage = $null
  try { Write-FinalAutoPublishReport } catch { $report.failureStage = "final-report"; $report.failureReason = $_.Exception.Message; Write-RecoveryReport -Status "push-complete-final-report-failed" -Stage "final-report" -Reason $_.Exception.Message; throw }
  Write-RecoveryReport -Status "success"
} catch {
  $exception = $_
  $reason = $exception.Exception.Message
  $report.failureType = $exception.Exception.GetType().FullName
  $report.scriptStackTrace = Get-TextTail -Text $exception.ScriptStackTrace -MaximumCharacters $ReportStackTraceChars
  if (-not $report.completedAt) { Write-RecoveryReport -Status "failed" -Stage $(if ($report.failureStage) { $report.failureStage } else { "unexpected" }) -Reason $reason }
  Write-Error $reason; exit 1
}
