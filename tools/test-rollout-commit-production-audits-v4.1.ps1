param(
  [string]$RolloutScriptPath = (Join-Path $PSScriptRoot "finish-yandoubuy-smokingpipes-rollout-v4.1.ps1")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

$source = [IO.File]::ReadAllText($RolloutScriptPath, [Text.UTF8Encoding]::new($false))
$tokens = $null
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($RolloutScriptPath, [ref]$tokens, [ref]$errors)
Assert-True ($errors.Count -eq 0) "Rollout script does not parse."

Assert-True ($source.Contains('[switch]$StopAfterValidate')) "Missing StopAfterValidate switch."

$ast = [Management.Automation.Language.Parser]::ParseFile($RolloutScriptPath, [ref]$tokens, [ref]$errors)
$gateCandidates = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-ProductionCommitUnexpectedPaths"
}, $true))
Assert-True ($gateCandidates.Count -eq 1) "Missing Get-ProductionCommitUnexpectedPaths."
$gateModule = New-Module -ScriptBlock ([scriptblock]::Create($gateCandidates[0].Extent.Text))

$auditOnly = @(& $gateModule {
  Get-ProductionCommitUnexpectedPaths -Changed @(
    "data/audits/product-displayname-zh-safe-candidates-report-20260616.json",
    "data/audits/product-displayname-zh-safe-candidates-samples-20260616.md"
  )
})
Assert-True ($auditOnly.Count -eq 0) "Audit outputs must be allowed by the production diff gate."

$unexpected = @(& $gateModule { Get-ProductionCommitUnexpectedPaths -Changed @("scripts/unrelated.mjs") })
Assert-True ($unexpected.Count -eq 1 -and $unexpected[0] -eq "scripts/unrelated.mjs") "Non-production paths must remain blocked."

$stageMatch = [regex]::Match($source, 'Invoke-Git "stage-production"[^\r\n]+')
Assert-True ($stageMatch.Success) "Missing stage-production command."
Assert-True (-not $stageMatch.Value.Contains('data/audits/')) "Audit outputs must not be staged by commit-production."

$stopIndex = $source.IndexOf('if ($StopAfterValidate)', [StringComparison]::Ordinal)
$commitIndex = $source.IndexOf('Invoke-Stage "commit-production"', [StringComparison]::Ordinal)
Assert-True ($stopIndex -ge 0 -and $stopIndex -lt $commitIndex) "StopAfterValidate must stop before commit-production."

Write-Host "ROLLOUT_COMMIT_PRODUCTION_AUDITS_TEST_PASS"
