$ErrorActionPreference = "Stop"

$wrapperPath = Join-Path (Split-Path -Parent $PSScriptRoot) "run-danish-auto-publish.ps1"
$wrapperSource = [IO.File]::ReadAllText($wrapperPath)
$functionStart = $wrapperSource.IndexOf("function Invoke-DanishGitPreflight {")
$functionEnd = $wrapperSource.IndexOf("function Get-DanishPushDeerKey {")
if ($functionStart -lt 0 -or $functionEnd -le $functionStart) {
    throw "Could not load Invoke-DanishGitPreflight from $wrapperPath"
}
. ([scriptblock]::Create($wrapperSource.Substring($functionStart, $functionEnd - $functionStart)))

function Invoke-FixtureGit {
    param([string]$RepositoryRoot, [string[]]$GitArguments)
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& git -C $RepositoryRoot @GitArguments 2>&1)
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Fixture git failed: git -C $RepositoryRoot $($GitArguments -join ' ') :: $(($output | ForEach-Object { [string]$_ }) -join ' ')"
    }
    return (($output | ForEach-Object { [string]$_ }) -join " ").Trim()
}

function Assert-PreflightBlocked {
    param([string]$RepositoryRoot, [string]$ExpectedPattern)
    try {
        Invoke-DanishGitPreflight -RepositoryRoot $RepositoryRoot
        throw "Expected git preflight to block $RepositoryRoot"
    }
    catch {
        if ($_.Exception.Message -like "Expected git preflight*") {
            throw
        }
        if ($_.Exception.Message -notmatch $ExpectedPattern) {
            throw "Unexpected git preflight failure: $($_.Exception.Message)"
        }
    }
}

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("danish-git-preflight-" + [guid]::NewGuid().ToString("N"))
$originRoot = Join-Path $fixtureRoot "origin.git"
$seedRoot = Join-Path $fixtureRoot "seed"

try {
    New-Item -Path $fixtureRoot -ItemType Directory -Force | Out-Null
    Invoke-FixtureGit -RepositoryRoot $fixtureRoot -GitArguments @("init", "--bare", $originRoot) | Out-Null

    New-Item -Path $seedRoot -ItemType Directory -Force | Out-Null
    Invoke-FixtureGit -RepositoryRoot $seedRoot -GitArguments @("init") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $seedRoot -GitArguments @("config", "user.email", "fixture@example.test") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $seedRoot -GitArguments @("config", "user.name", "Fixture") | Out-Null
    [IO.File]::WriteAllText((Join-Path $seedRoot "inventory.txt"), "initial`n")
    Invoke-FixtureGit -RepositoryRoot $seedRoot -GitArguments @("add", "inventory.txt") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $seedRoot -GitArguments @("commit", "-m", "fixture: initial") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $seedRoot -GitArguments @("branch", "-M", "main") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $seedRoot -GitArguments @("remote", "add", "origin", $originRoot) | Out-Null
    Invoke-FixtureGit -RepositoryRoot $seedRoot -GitArguments @("push", "-u", "origin", "main") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $originRoot -GitArguments @("symbolic-ref", "HEAD", "refs/heads/main") | Out-Null

    $currentRoot = Join-Path $fixtureRoot "current"
    $featureRoot = Join-Path $fixtureRoot "feature"
    $dirtyRoot = Join-Path $fixtureRoot "dirty"
    $updaterRoot = Join-Path $fixtureRoot "updater"
    $divergedRoot = Join-Path $fixtureRoot "diverged"
    Invoke-FixtureGit -RepositoryRoot $fixtureRoot -GitArguments @("clone", $originRoot, $currentRoot) | Out-Null
    Invoke-FixtureGit -RepositoryRoot $fixtureRoot -GitArguments @("clone", $originRoot, $featureRoot) | Out-Null
    Invoke-FixtureGit -RepositoryRoot $fixtureRoot -GitArguments @("clone", $originRoot, $dirtyRoot) | Out-Null

    Invoke-FixtureGit -RepositoryRoot $featureRoot -GitArguments @("checkout", "-b", "fixture-branch") | Out-Null
    Assert-PreflightBlocked -RepositoryRoot $featureRoot -ExpectedPattern "requires branch main"

    [IO.File]::WriteAllText((Join-Path $dirtyRoot "inventory.txt"), "dirty`n")
    Assert-PreflightBlocked -RepositoryRoot $dirtyRoot -ExpectedPattern "tracked working tree changes"

    Invoke-DanishGitPreflight -RepositoryRoot $currentRoot

    Invoke-FixtureGit -RepositoryRoot $fixtureRoot -GitArguments @("clone", $originRoot, $updaterRoot) | Out-Null
    Invoke-FixtureGit -RepositoryRoot $updaterRoot -GitArguments @("config", "user.email", "fixture@example.test") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $updaterRoot -GitArguments @("config", "user.name", "Fixture") | Out-Null
    [IO.File]::WriteAllText((Join-Path $updaterRoot "inventory.txt"), "remote-update`n")
    Invoke-FixtureGit -RepositoryRoot $updaterRoot -GitArguments @("add", "inventory.txt") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $updaterRoot -GitArguments @("commit", "-m", "fixture: remote update") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $updaterRoot -GitArguments @("push", "origin", "main") | Out-Null

    Invoke-DanishGitPreflight -RepositoryRoot $currentRoot
    $currentHead = Invoke-FixtureGit -RepositoryRoot $currentRoot -GitArguments @("rev-parse", "HEAD")
    $currentOrigin = Invoke-FixtureGit -RepositoryRoot $currentRoot -GitArguments @("rev-parse", "origin/main")
    if ($currentHead -ne $currentOrigin) {
        throw "Behind fixture did not fast-forward to origin/main"
    }

    Invoke-FixtureGit -RepositoryRoot $fixtureRoot -GitArguments @("clone", $originRoot, $divergedRoot) | Out-Null
    Invoke-FixtureGit -RepositoryRoot $divergedRoot -GitArguments @("config", "user.email", "fixture@example.test") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $divergedRoot -GitArguments @("config", "user.name", "Fixture") | Out-Null
    [IO.File]::WriteAllText((Join-Path $divergedRoot "local.txt"), "local-only`n")
    Invoke-FixtureGit -RepositoryRoot $divergedRoot -GitArguments @("add", "local.txt") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $divergedRoot -GitArguments @("commit", "-m", "fixture: local divergence") | Out-Null
    [IO.File]::WriteAllText((Join-Path $updaterRoot "remote.txt"), "remote-only`n")
    Invoke-FixtureGit -RepositoryRoot $updaterRoot -GitArguments @("add", "remote.txt") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $updaterRoot -GitArguments @("commit", "-m", "fixture: remote divergence") | Out-Null
    Invoke-FixtureGit -RepositoryRoot $updaterRoot -GitArguments @("push", "origin", "main") | Out-Null
    Assert-PreflightBlocked -RepositoryRoot $divergedRoot -ExpectedPattern "merge --ff-only origin/main failed"

    Write-Output "Danish Git preflight fixture tests passed"
}
finally {
    if ($fixtureRoot.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $fixtureRoot)) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
