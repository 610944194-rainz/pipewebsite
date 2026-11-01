$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot 'test-danish-pc-update-setup-v1.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors -join "`n") }
$definition = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-DanishActionSyncDiagnostic' }, $true)
. ([scriptblock]::Create($definition.Extent.Text))
$wrapper = 'C:\Users\PC User\pipewebsite\scripts\run-danish-auto-publish.ps1'
foreach ($mode in @('Publish', 'Daily', 'CollectOnly')) {
    $action = [pscustomobject]@{ Execute = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'; Arguments = "-NoProfile -File `"$wrapper`" -$mode -ShutdownAfterRun"; WorkingDirectory = 'C:\Users\PC User\pipewebsite' }
    $result = Get-DanishActionSyncDiagnostic -Action $action -ExpectedWrapper $wrapper
    if (-not $result.autoSyncConfigured -or -not $result.requiresLatestCode) { throw "Valid $mode action rejected" }
}
foreach ($arguments in @('-File "C:\Other\run-danish-auto-publish.ps1" -Publish', '-File "C:\Users\PC User\pipewebsite\scripts\run-danish-auto-publish.ps1" -DryRun', 'scripts/inventory/run-danish-daily-v1.mjs --publish')) {
    $result = Get-DanishActionSyncDiagnostic -Action ([pscustomobject]@{ Execute = 'powershell.exe'; Arguments = $arguments }) -ExpectedWrapper $wrapper
    if ($result.autoSyncConfigured) { throw "Unsupported action was marked synchronized: $arguments" }
}
$result = Get-DanishActionSyncDiagnostic -Action ([pscustomobject]@{ Execute = 'powershell.exe'; Arguments = "-File `"$wrapper`" -Publish -AllowCachedCode" }) -ExpectedWrapper $wrapper
if ($result.requiresLatestCode) { throw 'Cached-code override was not detected' }
Write-Output 'Danish PC scheduled-action diagnostic fixtures passed'
