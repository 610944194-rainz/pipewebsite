param(
  [string]$AutomationWorktree = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-run",
  [string]$BuildExecutable = "C:\Program Files\nodejs\npm.cmd"
)

$ErrorActionPreference = "Stop"
$wrapper = Join-Path $AutomationWorktree "scripts\inventory\run-smokingpipes-auto-publish.ps1"
$logRoot = Join-Path $AutomationWorktree "data\review\smokingpipes-scheduled-logs"
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw "Smokingpipes auto-publish wrapper is missing: $wrapper" }
if (-not (Test-Path -LiteralPath $BuildExecutable -PathType Leaf)) { throw "Build executable is missing: $BuildExecutable" }
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$logPath = Join-Path $logRoot ("smokingpipes-daily-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

$exitCode = 1
Start-Transcript -LiteralPath $logPath -Force | Out-Null
try {
  & $wrapper `
    -AutomationWorktree $AutomationWorktree `
    -BuildExecutable $BuildExecutable `
    -ForceRunOnce
  $exitCode = $LASTEXITCODE
} catch {
  Write-Error $_.Exception.Message
  $exitCode = 1
} finally {
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
exit $exitCode
