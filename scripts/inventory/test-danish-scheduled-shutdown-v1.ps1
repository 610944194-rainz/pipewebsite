$ErrorActionPreference = 'Stop'
$wrapper = Join-Path (Split-Path -Parent $PSScriptRoot) 'run-danish-auto-publish.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($wrapper, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors -join "`n") }
$definition = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-DanishScheduledShutdown' }, $true)
. ([scriptblock]::Create($definition.Extent.Text))
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Write-DanishSchedulerLaunchLog { param($EventName, $Details) $script:events += $EventName }
foreach ($case in @('manual', 'dry-run', 'success', 'failure', 'lock', 'profile-lock', 'active-process', 'process-query-error', 'shutdown-error')) {
  $script:calls = 0; $script:events = @()
  $parameters = @{
    Enabled = ($case -ne 'manual'); PublishMode = ($case -ne 'dry-run')
    RunExitCode = $(if ($case -eq 'failure') { 1 } else { 0 })
    RepositoryRoot = 'C:\fixture'
    PathExists = { param($Path) return ($case -eq 'lock' -and $Path.EndsWith('danish-daily.lock')) -or ($case -eq 'profile-lock' -and $Path.EndsWith('.danish-v18-profile.lock')) }
    HasActiveProcess = { param($Root) if ($case -eq 'process-query-error') { throw 'process-query-failed' }; return $case -eq 'active-process' }
    ExecuteShutdown = { $script:calls++; if ($case -eq 'shutdown-error') { return 5 }; return 0 }
  }
  if ($case -in @('shutdown-error', 'process-query-error')) {
    $failed = $false
    try { Invoke-DanishScheduledShutdown @parameters | Out-Null } catch { $failed = $true }
    Assert $failed 'shutdown command errors must not be treated as success'
    if ($case -eq 'process-query-error') { Assert ($script:calls -eq 0) 'uncertain process state must not shut down' }
  } else {
    $result = Invoke-DanishScheduledShutdown @parameters
    $expected = $case -in @('success', 'failure')
    Assert ($result -eq $expected) "Unexpected shutdown decision: $case"
    Assert ($script:calls -eq [int]$expected) "Unexpected shutdown execution: $case"
  }
  Write-Host "PASS $case (mock only)"
}
$source = [IO.File]::ReadAllText($wrapper)
Assert ($source.Contains('shutdown.exe" /s /t 0')) 'must request normal shutdown without positive forced timeout'
Assert ($source.Contains('finally {') -and $source.LastIndexOf('Invoke-DanishScheduledShutdown -Enabled') -gt $source.LastIndexOf('Send-DanishPushDeer `')) 'shutdown must run after notification path in finally'
Write-Host 'Danish scheduled shutdown focused tests passed; no real shutdown executed'
