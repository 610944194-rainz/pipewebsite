Set-StrictMode -Version Latest

function Get-SmokingpipesTextTail {
  param([string]$Text, [int]$MaximumCharacters = 32768)
  if ([string]::IsNullOrEmpty($Text) -or $Text.Length -le $MaximumCharacters) { return $Text }
  return "[truncated; originalChars=$($Text.Length)]`n" + $Text.Substring($Text.Length - $MaximumCharacters)
}

function Invoke-SmokingpipesCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [ValidateRange(1, 7200)][int]$TimeoutSeconds = 600,
    [ValidateRange(1024, 32768)][int]$TailCharacters = 32768
  )
  if (-not [IO.Path]::IsPathRooted($FilePath) -or -not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "$Stage executable must be an existing absolute leaf path: $FilePath"
  }
  $nodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
  $runnerPath = Join-Path $PSScriptRoot "smokingpipes-command-runner-v1.mjs"
  if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { throw "command runner is missing: $runnerPath" }
  $resultRoot = Join-Path $env:TEMP "smokingpipes-command-execution"
  New-Item -ItemType Directory -Force -Path $resultRoot | Out-Null
  $id = [guid]::NewGuid().ToString("N")
  $resultPath = Join-Path $resultRoot ($id + ".result.json")
  $requestPath = Join-Path $resultRoot ($id + ".request.json")
  try {
    $request = [ordered]@{ stage=$Stage; file=$FilePath; cwd=$WorkingDirectory; result=$resultPath; timeout=$TimeoutSeconds; tail=$TailCharacters; commandArgs=@($Arguments) }
    [IO.File]::WriteAllText($requestPath, (($request | ConvertTo-Json -Depth 4 -Compress) + "`n"), [Text.UTF8Encoding]::new($false))
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $nodePath
    $startInfo.Arguments = '"' + $runnerPath.Replace('"', '\"') + '" --request "' + $requestPath.Replace('"', '\"') + '"'
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true; $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
    $helper = [Diagnostics.Process]::new(); $helper.StartInfo = $startInfo
    if (-not $helper.Start()) { throw "$Stage command runner did not start" }
    $stdoutCopy = $helper.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    $stderrCopy = $helper.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
    $helper.WaitForExit(); [void]$stdoutCopy.GetAwaiter().GetResult(); [void]$stderrCopy.GetAwaiter().GetResult(); $helperExitCode = $helper.ExitCode
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) { throw "$Stage command runner did not produce a result (helperExitCode=$helperExitCode)" }
    $result = Get-Content -LiteralPath $resultPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($helperExitCode -ne 0 -or $result.spawnError) { throw "$Stage command runner failed: $($result.stderrTail)" }
    if ($result.timedOut -eq $true) { throw "$Stage timed out after $TimeoutSeconds seconds" }
    if ([int]$result.exitCode -ne 0) { throw "$Stage failed with exit code $($result.exitCode): $($result.stderrTail)$($result.stdoutTail)" }
    return $result
  } finally {
    foreach ($path in @($requestPath, $resultPath)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
  }
}

Export-ModuleMember -Function Invoke-SmokingpipesCommand, Get-SmokingpipesTextTail
