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

  $lastSuccessfulDate = [string]$State.lastSuccessfulLocalDate
  $lastSuccessfulStatus = [string]$State.lastSuccessfulStatus
  $hasExplicitSuccess =
    $lastSuccessfulDate -eq $LocalDateKey -and
    $script:SuccessfulDailyStatuses -contains $lastSuccessfulStatus -and
    -not [string]::IsNullOrWhiteSpace([string]$State.lastSuccessfulRunId)

  if ($hasExplicitSuccess) {
    return [pscustomobject]@{ ShouldSkip = $true; Reason = "explicit-same-day-success" }
  }

  # Compatibility for the already-persisted legacy skip marker.  Do not infer
  # success from a bare legacy "success" state because it may predate final
  # validator/build/publish completion.
  $isLegacySkip =
    [string]$State.dateKey -eq $LocalDateKey -and
    [string]$State.status -eq "skipped-success" -and
    $State.productionWritten -eq $true
  if ($isLegacySkip) {
    return [pscustomobject]@{ ShouldSkip = $true; Reason = "legacy-skipped-success" }
  }

  return [pscustomobject]@{ ShouldSkip = $false; Reason = "not-completed" }
}

Export-ModuleMember -Function Get-SmokingpipesLocalDateKey, Read-SmokingpipesDailyTaskState, Test-SmokingpipesSameDaySuccess
