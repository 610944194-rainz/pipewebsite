Set-StrictMode -Version Latest

$script:SuccessfulDailyStatuses = @(
  "success",
  "production-change-complete",
  "no-production-change",
  "validated-no-push"
)

function Get-SmokingpipesLocalDateKey {
  param([datetime]$Now = (Get-Date))
  return $Now.ToString("yyyy-MM-dd")
}

function Get-OptionalSmokingpipesStateValue {
  param(
    [object]$State,
    [Parameter(Mandatory = $true)][string]$Name,
    [object]$DefaultValue = $null
  )

  if ($null -eq $State) {
    return $DefaultValue
  }

  $property = $State.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) {
    return $DefaultValue
  }

  return $property.Value
}

function Read-SmokingpipesDailyTaskState {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }

  try {
    $json = (Get-Content -LiteralPath $Path -Raw -Encoding utf8).TrimStart([char]0xFEFF)
    if ([string]::IsNullOrWhiteSpace($json)) { return $null }
    return $json | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{ __stateReadError = "state-json-parse-failed" }
  }
}

function Test-SmokingpipesSameDaySuccess {
  param(
    [object]$State,
    [string]$LocalDateKey = (Get-SmokingpipesLocalDateKey),
    [switch]$ForceSameDayRerun
  )

  if ($ForceSameDayRerun -or -not $State) {
    return [pscustomobject]@{ ShouldSkip = $false; Reason = "not-completed" }
  }

  $lastSuccessfulDate = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "lastSuccessfulLocalDate" -DefaultValue "")
  $lastSuccessfulStatus = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "lastSuccessfulStatus" -DefaultValue "")
  $lastSuccessfulRunId = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "lastSuccessfulRunId" -DefaultValue "")
  $hasExplicitSuccess =
    $lastSuccessfulDate -eq $LocalDateKey -and
    $script:SuccessfulDailyStatuses -contains $lastSuccessfulStatus -and
    -not [string]::IsNullOrWhiteSpace($lastSuccessfulRunId)

  if ($hasExplicitSuccess) {
    return [pscustomobject]@{ ShouldSkip = $true; Reason = "explicit-same-day-success" }
  }

  # Compatibility for the already-persisted legacy skip marker.  Do not infer
  # success from a bare legacy "success" state because it may predate final
  # validator/build/publish completion.
  $legacyDateKey = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "dateKey" -DefaultValue "")
  $legacyStatus = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "status" -DefaultValue "")
  $legacyProductionWritten = Get-OptionalSmokingpipesStateValue -State $State -Name "productionWritten" -DefaultValue $false
  $isLegacySkip =
    $legacyDateKey -eq $LocalDateKey -and
    $legacyStatus -eq "skipped-success" -and
    $legacyProductionWritten -eq $true
  if ($isLegacySkip) {
    return [pscustomobject]@{ ShouldSkip = $true; Reason = "legacy-skipped-success" }
  }

  return [pscustomobject]@{ ShouldSkip = $false; Reason = "not-completed" }
}

function Test-SmokingpipesSameDayFailureRetryPolicy {
  param(
    [object]$State,
    [string]$LocalDateKey = (Get-SmokingpipesLocalDateKey)
  )

  $allow = {
    param([string]$Reason)
    return [pscustomobject]@{
      ShouldSkip = $false
      RetryAllowed = $true
      Reason = $Reason
      RequiresPreflight = $true
      HardTerminal = $false
    }
  }
  $stop = {
    param([string]$Reason)
    return [pscustomobject]@{
      ShouldSkip = $true
      RetryAllowed = $false
      Reason = $Reason
      RequiresPreflight = $false
      HardTerminal = $true
    }
  }

  if (-not $State) { return & $allow "no-state" }
  if ([string](Get-OptionalSmokingpipesStateValue -State $State -Name "__stateReadError" -DefaultValue "")) {
    return & $stop "state-json-corrupt-requires-manual-recovery"
  }
  $dateKey = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "dateKey" -DefaultValue "")
  if ($dateKey -ne $LocalDateKey) { return & $allow "different-local-day" }

  $productionWritten = [bool](Get-OptionalSmokingpipesStateValue -State $State -Name "productionWritten" -DefaultValue $false)
  $status = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "status" -DefaultValue "")
  $failureType = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "lastFailureType" -DefaultValue "")
  $reason = [string](Get-OptionalSmokingpipesStateValue -State $State -Name "lastFailureReason" -DefaultValue "")
  $commitPerformed = [bool](Get-OptionalSmokingpipesStateValue -State $State -Name "commitPerformed" -DefaultValue $false)
  $pushPerformed = [bool](Get-OptionalSmokingpipesStateValue -State $State -Name "pushPerformed" -DefaultValue $false)
  $hardEvidence = "$failureType $reason $status"

  if ($productionWritten) {
    return & $stop "production-write-state-requires-manual-recovery"
  }
  if ($commitPerformed -or $pushPerformed) {
    return & $stop "commit-or-push-state-requires-manual-recovery"
  }
  if ($hardEvidence -match "validator|public index|duplicate( id| sourceproductid)?|public catalog.*empty|unexpected deletion|zeropricesellable|leak|checkpoint.*json|state.*json|backup|post-write|commit.*ambiguous|push.*ambiguous") {
    return & $stop "hard-safety-evidence-requires-manual-recovery"
  }
  if ($failureType -in @("lock", "network", "browser", "verification", "preflight", "detail-queue-spike", "audit")) {
    return & $allow "pre-production-$failureType-retry"
  }
  if ($status -in @("retryable-failed", "terminal-failed", "manual-review-required", "safety-gate-blocked")) {
    return & $allow "pre-production-failure-retry"
  }
  return & $allow "not-a-terminal-failure"
}

Export-ModuleMember -Function Get-SmokingpipesLocalDateKey, Get-OptionalSmokingpipesStateValue, Read-SmokingpipesDailyTaskState, Test-SmokingpipesSameDaySuccess, Test-SmokingpipesSameDayFailureRetryPolicy
