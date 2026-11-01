# Read-only: no scheduled task changes, fetch, merge, collection, or publication.
[CmdletBinding()]
param([string]$TaskName = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$wrapper = Join-Path $root "scripts\run-danish-auto-publish.ps1"

function Get-DanishActionSyncDiagnostic {
    param($Action, [string]$ExpectedWrapper)
    $arguments = [string]$Action.Arguments
    $fileMatch = [regex]::Match($arguments, '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|([^\s]+))')
    $file = if ($fileMatch.Success) { ($fileMatch.Groups[1].Value + $fileMatch.Groups[2].Value) } else { "" }
    $correctWrapper = $file -and [string]::Equals($file, $ExpectedWrapper, [StringComparison]::OrdinalIgnoreCase)
    $shell = [IO.Path]::GetFileName(([string]$Action.Execute).Replace("\", "/"))
    $isPowerShell = $shell -in @("powershell.exe", "pwsh.exe", "powershell", "pwsh")
    $liveMode = $arguments -match '(?i)(?:^|\s)-(?:Publish|Daily|CollectOnly)(?:\s|$)'
    [pscustomobject]@{
        execute = $Action.Execute
        arguments = $arguments
        workingDirectory = $Action.WorkingDirectory
        usesExpectedSyncWrapper = [bool]($correctWrapper -and $isPowerShell)
        liveMode = [bool]$liveMode
        requiresLatestCode = ($arguments -notmatch '(?i)(?:^|\s)-AllowCachedCode(?:\s|$)')
        autoSyncConfigured = [bool]($correctWrapper -and $isPowerShell -and $liveMode)
    }
}

if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) {
    throw "Run this read-only check on the Windows PC that owns the Danish scheduled task."
}
$tasks = @(Get-ScheduledTask | Where-Object {
    if ($TaskName) { $_.TaskName -eq $TaskName }
    else { $_.TaskName -match "Danish" -or ($_.Actions.Arguments -join " ") -match "danish" }
})
if (-not $tasks.Count) { throw "No Danish scheduled task found; supply -TaskName for a custom task name." }
$head = & git -C $root rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw "Could not read PC repository HEAD." }
$tracked = & git -C $root status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0) { throw "Could not inspect tracked PC changes." }
$branch = & git -C $root branch --show-current
if ($LASTEXITCODE -ne 0) { throw "Could not inspect PC branch." }
$wrapperSource = [IO.File]::ReadAllText($wrapper)
$strictSyncInstalled = $wrapperSource.Contains("latest-code-required")
$reports = @($tasks | ForEach-Object {
    $task = $_
    $actions = @($task.Actions | ForEach-Object { Get-DanishActionSyncDiagnostic -Action $_ -ExpectedWrapper $wrapper })
    [pscustomobject]@{
        taskName = $task.TaskName; taskPath = $task.TaskPath; state = [string]$task.State
        repository = $root; codeRevision = $head; branch = $branch
        trackedChanges = [bool]$tracked; strictSyncInstalled = $strictSyncInstalled
        actions = $actions
        ready = ($task.State -ne "Disabled" -and $branch -eq "main" -and -not $tracked -and
            $strictSyncInstalled -and $actions.Count -eq 1 -and $actions[0].autoSyncConfigured -and $actions[0].requiresLatestCode)
    }
})
$reports | ConvertTo-Json -Depth 6
if (@($reports | Where-Object { -not $_.ready }).Count) {
    throw "PC setup needs attention. Preserve the task's schedule/options; use this repository's absolute scripts\run-danish-auto-publish.ps1 entry with its existing live mode. See docs/danish-pc-code-sync.md."
}
