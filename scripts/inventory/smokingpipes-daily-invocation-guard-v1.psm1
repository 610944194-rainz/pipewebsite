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
    return $null
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

Export-ModuleMember -Function Get-SmokingpipesLocalDateKey, Get-OptionalSmokingpipesStateValue, Read-SmokingpipesDailyTaskState, Test-SmokingpipesSameDaySuccess
