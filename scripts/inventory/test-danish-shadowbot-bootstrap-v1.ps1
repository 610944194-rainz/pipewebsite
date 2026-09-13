$ErrorActionPreference = 'Stop'
$wrapper = Join-Path (Split-Path -Parent $PSScriptRoot) 'run-danish-auto-publish.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($wrapper, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors -join "`n") }
$definition = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Ensure-ShadowBotReady' }, $true)
. ([scriptblock]::Create($definition.Extent.Text))
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Write-DanishSchedulerLaunchLog { param($EventName, $Details) }
function Test-Path { param($LiteralPath, $PathType) return $true }
function Start-Process { param($FilePath, $WindowStyle, $ErrorAction) $script:launches++ }
function Get-Process {
    param($Name, $ErrorAction)
    if ($script:scenario -eq 'ready' -or ($script:scenario -eq 'bootstrap' -and $script:launches -gt 0)) {
        return [pscustomobject]@{ Id = 123; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; Path = 'E:\ShadowBot\version\ShadowBot.Shell.exe' }
    }
    if ($script:scenario -eq 'other-session') {
        return [pscustomobject]@{ Id = 456; SessionId = -1; Path = 'E:\ShadowBot\version\ShadowBot.Shell.exe' }
    }
}
function Test-DanishShadowBotReady { param($CliPath, $TimeoutMilliseconds) $script:queries++; return $true }
$savedLauncher = $env:DANISH_RPA_EXE
try {
    $env:DANISH_RPA_EXE = 'E:\ShadowBot\ShadowBot.exe'
    foreach ($case in @('ready', 'bootstrap', 'other-session', 'timeout')) {
        $script:scenario = $case
        $script:launches = 0
        $script:queries = 0
        $collectorStarted = $false
        $failed = $false
        try { $result = Ensure-ShadowBotReady -TimeoutSeconds 1; $collectorStarted = $true }
        catch { $failed = $true; Assert ($_.Exception.Message -eq 'ShadowBot not ready') 'Unexpected failure' }
        if ($case -eq 'ready') {
            Assert (-not $failed -and $script:launches -eq 0 -and $script:queries -eq 1) 'A: existing Shell must not restart'
        } elseif ($case -eq 'bootstrap') {
            Assert (-not $failed -and $script:launches -eq 1 -and $result.Ready) 'B: bootstrap should become ready'
        } else {
            Assert ($failed -and -not $collectorStarted -and $script:launches -eq 1 -and $script:queries -eq 0) 'C/D: must fail closed without same-session Shell'
        }
        Write-Host "PASS $case"
    }
    $source = [IO.File]::ReadAllText($wrapper)
    $gateStart = $source.IndexOf('if ($mode -in @("daily", "publish", "collect-only"))')
    $nodeStart = $source.IndexOf('& node @arguments')
    Assert ($gateStart -gt 0 -and $gateStart -lt $nodeStart) 'Preflight must precede Node and exclude DryRun'
    Assert ($source.Substring($gateStart, $nodeStart - $gateStart).Contains('exit 1')) 'Failure must exit before Node'
    Write-Host 'PASS wrapper dispatch / DryRun exclusion / fail-closed ordering'
} finally { $env:DANISH_RPA_EXE = $savedLauncher }
