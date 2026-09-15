$ErrorActionPreference = 'Stop'
$wrapper = Join-Path (Split-Path -Parent $PSScriptRoot) 'run-danish-auto-publish.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($wrapper, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors -join "`n") }
foreach ($name in @('Test-DanishShadowBotReady', 'Protect-DanishHealthText', 'Write-DanishHealthDiagnostic')) {
    $definition = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert($ok, $message) { if (-not $ok) { throw $message } }
function Write-DanishSchedulerLaunchLog { param($EventName, $Details) $script:records += [pscustomobject]@{ Event = $EventName; Detail = $Details } }
function New-Object {
    param($TypeName)
    if ($TypeName -ne 'System.Diagnostics.Process') { throw 'Unexpected object' }
    $stream = [pscustomobject]@{}
    $stream | Add-Member ScriptMethod ReadToEndAsync { return [pscustomobject]@{ IsCompleted = ($script:case -ne 'incomplete'); Status = 'RanToCompletion'; Result = $script:payload } }
    $p = [pscustomobject]@{ StartInfo = [pscustomobject]@{FileName='';Arguments='';UseShellExecute=$true;CreateNoWindow=$false;RedirectStandardOutput=$false;RedirectStandardError=$false;StandardOutputEncoding=$null;StandardErrorEncoding=$null}; Id=123; ExitCode=0; HasExited=$true; StandardOutput=$stream; StandardError=$stream }
    $p | Add-Member ScriptMethod Start { if ($script:case -eq 'spawn-error') { throw 'fixture token=secret' }; return $true }
    $p | Add-Member ScriptMethod WaitForExit { param($milliseconds) return ($script:case -ne 'timeout') }
    $p | Add-Member ScriptMethod Dispose { }
    return $p
}
foreach ($case in @('ready', 'api-failed', 'bad-json', 'incomplete', 'timeout', 'spawn-error')) {
    $script:case = $case
    $script:payload = if ($case -eq 'bad-json') { 'invalid' } elseif ($case -eq 'api-failed') { '{"ok":false,"apiCode":1}' } else { '{"ok":true,"apiCode":0}' }
    $script:records = @()
    $result = Test-DanishShadowBotReady -CliPath 'fixture.exe' -TimeoutMilliseconds 50 -Shell ([pscustomobject]@{Id=42;SessionId=1;Path='fixture-shell'})
    Assert ($result -eq ($case -eq 'ready')) "Return semantics changed: $case"
    Assert ($script:records.Count -eq 1) "Missing diagnostic: $case"
    $d = $script:records[0].Detail | ConvertFrom-Json
    Assert ($d.shellPid -eq 42 -and $d.timeoutMilliseconds -eq 50) 'Diagnostic context missing'
    Assert ($script:records[0].Detail -notmatch 'token=secret') 'Secret leaked'
    if ($case -eq 'incomplete') {
        Assert ($d.waitForExit -and $d.exitCode -eq 0 -and -not $d.stdoutIsCompleted) 'Race observation missing'
        Assert ($d.'probable-root-cause' -eq 'async-output-race') 'Probable race marker missing'
    }
    if ($case -eq 'ready') {
        Assert ($d.stderrIsCompleted -and $d.stderrLength -eq $script:payload.Length) 'Stderr diagnostics missing'
        Assert ($null -eq $d.'probable-root-cause') 'False race marker'
    }
    Write-Host "PASS diagnostic $case"
}
$script:records = @()
$d = $script:healthLastDiagnostic
$d.attempt = 2
Write-DanishHealthDiagnostic $d
Assert ($script:records.Count -eq 0) 'Repeated failure not throttled'
Write-DanishHealthDiagnostic $d -Final
Assert ($script:records.Count -eq 1) 'Final failure missing'
$source = [IO.File]::ReadAllText($wrapper)
$dispatch = $ast.Find({ param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -eq '$ShadowBotPreflightOnly' }, $true)
Assert ($null -ne $dispatch) 'Diagnostic dispatch missing'
Assert ($dispatch.Extent.StartOffset -lt $source.IndexOf('$gitPreflight = Invoke-DanishGitPreflight')) 'Diagnostic mode reached Git'
Assert ($dispatch.Extent.Text -match 'exit 0' -and $dispatch.Extent.Text -match 'exit 1') 'Diagnostic mode must always exit'
Assert ($dispatch.Extent.Text -notmatch 'Send-DanishPushDeer|& node|Invoke-DanishGitPreflight') 'Unsafe diagnostic dispatch'
Write-Host 'PASS throttling / redaction / preflight-only isolation / PowerShell parse'
