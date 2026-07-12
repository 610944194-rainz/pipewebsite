param(
  [string]$RolloutScriptPath = (Join-Path $PSScriptRoot "finish-yandoubuy-smokingpipes-rollout-v4.1.ps1")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($RolloutScriptPath, [ref]$tokens, [ref]$errors)
Assert-True ($errors.Count -eq 0) "Rollout script does not parse."

$restoreCandidates = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Restore-Production"
}, $true))
Assert-True ($restoreCandidates.Count -eq 1) "Missing Restore-Production."

$restoreText = $restoreCandidates[0].Extent.Text
$seriesGenerator = 'Invoke-External "rollback-series-index"'
$validator = 'Invoke-External "rollback-validator"'
$seriesIndex = $restoreText.IndexOf($seriesGenerator, [StringComparison]::Ordinal)
$validatorIndex = $restoreText.IndexOf($validator, [StringComparison]::Ordinal)

Assert-True ($seriesIndex -ge 0) "Rollback does not regenerate series.json with the LF generator."
Assert-True ($restoreText.Contains('scripts/audit-product-series-candidates-v1.mjs')) "Rollback series generator is missing."
Assert-True ($validatorIndex -gt $seriesIndex) "Rollback validator must run after the series generator."

Write-Host "ROLLOUT_SERIES_LINE_ENDINGS_TEST_PASS"
