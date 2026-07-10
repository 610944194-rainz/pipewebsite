param(
  [string]$AutomationWorktree = "C:\Users\NING MEI\Desktop\pipewebsite-automation",
  [string]$AutomationBranch = "automation/smokingpipes-publish"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RequiredScripts = @(
  "scripts/inventory/run-smokingpipes-progressive-daily.ps1",
  "scripts/inventory/run-smokingpipes-auto-publish.ps1",
  "scripts/inventory/run-inventory-automation-v1.mjs",
  "scripts/inventory/smokingpipes-progressive-runner-v1.mjs"
)

function Invoke-GitChecked {
  param([string[]]$Arguments)
  $output = @(& git -C $ProjectRoot @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  return ($output -join [Environment]::NewLine).Trim()
}

function Test-RegisteredWorktree {
  param([string]$PathToCheck)
  $target = [IO.Path]::GetFullPath($PathToCheck).TrimEnd("\\")
  $entries = Invoke-GitChecked -Arguments @("worktree", "list", "--porcelain")
  return $entries -split "`n" | Where-Object {
    $_ -match "^worktree\s+" -and
    ([IO.Path]::GetFullPath($_.Substring(9)).TrimEnd("\\") -eq $target)
  } | Select-Object -First 1
}

Invoke-GitChecked -Arguments @("fetch", "origin") | Out-Null
foreach ($required in $RequiredScripts) {
  & git -C $ProjectRoot cat-file -e "origin/main:$required" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "required automation code is not yet on origin/main"
  }
}

$targetExists = Test-Path -LiteralPath $AutomationWorktree
if ($targetExists -and -not (Test-RegisteredWorktree -PathToCheck $AutomationWorktree)) {
  throw "automation worktree target already exists but is not a registered worktree; refusing to overwrite it"
}

if (-not $targetExists) {
  Invoke-GitChecked -Arguments @(
    "worktree", "add", "-b", $AutomationBranch, $AutomationWorktree, "origin/main"
  ) | Out-Null
  Invoke-GitChecked -Arguments @("-C", $AutomationWorktree, "branch", "--set-upstream-to=origin/main", $AutomationBranch) | Out-Null
}

$targetStatus = @(& git -C $AutomationWorktree status --porcelain --untracked-files=no)
if ($targetStatus.Count -gt 0) {
  throw "automation worktree is not clean; refusing to continue"
}
$targetHead = (& git -C $AutomationWorktree rev-parse HEAD).Trim()
$originMain = (& git -C $AutomationWorktree rev-parse origin/main).Trim()
if ($targetHead -ne $originMain) {
  throw "automation worktree HEAD does not match origin/main"
}
foreach ($required in $RequiredScripts) {
  if (-not (Test-Path -LiteralPath (Join-Path $AutomationWorktree $required))) {
    throw "automation worktree is missing required script: $required"
  }
}

Write-Output "Automation worktree ready: $AutomationWorktree"
Write-Output "HEAD matches origin/main: $targetHead"
Write-Output "Automation branch: $((& git -C $AutomationWorktree branch --show-current).Trim())"
