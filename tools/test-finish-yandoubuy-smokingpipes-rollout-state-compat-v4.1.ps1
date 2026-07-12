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

$compatibilityCandidates = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Initialize-StateCompatibility"
}, $true))
Assert-True ($compatibilityCandidates.Count -eq 1) "Missing Initialize-StateCompatibility."
$compatibilityFunction = $compatibilityCandidates[0]
$stateAssignmentFields = @(
  $ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
      $node.Left.Extent.Text -match '^\$script:State\.([A-Za-z_][A-Za-z0-9_]*)$'
  }, $true) | ForEach-Object {
    [regex]::Match($_.Left.Extent.Text, '^\$script:State\.([A-Za-z_][A-Za-z0-9_]*)$').Groups[1].Value
  } | Sort-Object -Unique
)
Assert-True ($stateAssignmentFields.Count -gt 0) "No rollout state assignment targets were found."

$module = New-Module -ScriptBlock ([scriptblock]::Create($compatibilityFunction.Extent.Text))
$legacy = [pscustomobject]@{
  schemaVersion = 2; runId = "legacy-state"; completedStages = @("apply-production")
  currentStage = "apply-production"; productionWriteStarted = $true; backupRoot = "C:\legacy-backup"
}

& $module { param($State) Initialize-StateCompatibility -State $State | Out-Null } $legacy

foreach ($field in $stateAssignmentFields) {
  Assert-True ($null -ne $legacy.PSObject.Properties[$field]) "Legacy state is missing writable field: $field"
}
Assert-True (-not [bool]$legacy.applyCompleted) "Legacy applyCompleted default is not false."
Assert-True ($null -eq $legacy.productionApplySnapshot) "Legacy productionApplySnapshot default is not null."
Assert-True ([bool]$legacy.productionWriteStarted) "Existing legacy values must not be overwritten."
Assert-True ($null -ne $legacy.PSObject.Properties["logRoot"]) "Legacy state is missing derived logRoot."
Assert-True ($null -ne $legacy.PSObject.Properties["reportRoot"]) "Legacy state is missing derived reportRoot."
Assert-True ($legacy.logRoot -eq "C:\legacy-backup\logs") "Legacy logRoot was not derived from backupRoot."
Assert-True ($legacy.reportRoot -eq "C:\legacy-backup\review") "Legacy reportRoot was not derived from backupRoot."

$modern = [pscustomobject]@{
  schemaVersion = 2; runId = "modern-state"; backupRoot = "C:\modern-backup"
  applyCompleted = $true; productionApplySnapshot = [pscustomobject]@{ marker = "keep" }
}
& $module { param($State) Initialize-StateCompatibility -State $State | Out-Null } $modern
Assert-True ([bool]$modern.applyCompleted) "Existing applyCompleted value was overwritten."
Assert-True ($modern.productionApplySnapshot.marker -eq "keep") "Existing productionApplySnapshot value was overwritten."

Write-Host "ROLLOUT_STATE_COMPAT_TEST_PASS"
