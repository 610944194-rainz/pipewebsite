Set-StrictMode -Version Latest

function Get-SmokingpipesCommandArgumentLine {
  param([string[]]$Arguments)
  return (($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
  }) -join ' ')
}

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
  $tempRoot = Join-Path $env:TEMP "smokingpipes-command-execution"
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  $id = [guid]::NewGuid().ToString('N')
  $stdoutPath = Join-Path $tempRoot "$id.stdout.log"
  $stderrPath = Join-Path $tempRoot "$id.stderr.log"
  $argumentLine = Get-SmokingpipesCommandArgumentLine -Arguments $Arguments
  $started = Get-Date
  $process = $null
  $timedOut = $false
  $stdoutPosition = [int64]0
  $stderrPosition = [int64]0
  try {
    Write-Host "[START] $Stage timeout=${TimeoutSeconds}s"
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath; $startInfo.Arguments = $argumentLine; $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true; $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "$Stage process did not start" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
    while (-not $process.HasExited) {
      $elapsed = (Get-Date) - $started
      foreach ($stream in @(@{Path=$stdoutPath;Position=[ref]$stdoutPosition;Writer=[Console]::Out}, @{Path=$stderrPath;Position=[ref]$stderrPosition;Writer=[Console]::Error})) {
        if (Test-Path -LiteralPath $stream.Path) {
          $file = [IO.File]::Open($stream.Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
          try { if ($file.Length -gt $stream.Position.Value) { [void]$file.Seek($stream.Position.Value, [IO.SeekOrigin]::Begin); $buffer = New-Object byte[] ($file.Length - $stream.Position.Value); [void]$file.Read($buffer, 0, $buffer.Length); $stream.Position.Value = $file.Position; $stream.Writer.Write([Text.Encoding]::UTF8.GetString($buffer)) } } finally { $file.Dispose() }
        }
      }
      if ($elapsed.TotalSeconds -ge $TimeoutSeconds) {
        $timedOut = $true
        & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
        break
      }
      if ([int]$elapsed.TotalSeconds -gt 0 -and ([int]$elapsed.TotalSeconds % 60) -eq 0) { Write-Host "[PROGRESS] $Stage still-running elapsed=$([int]$elapsed.TotalSeconds)s pid=$($process.Id)" }
      Start-Sleep -Seconds 1
      $process.Refresh()
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult(); $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($stdout) { [Console]::Out.Write($stdout) }; if ($stderr) { [Console]::Error.Write($stderr) }
    $duration = [math]::Round(((Get-Date) - $started).TotalSeconds, 2)
    $result = [pscustomobject]@{ Stage=$Stage; Pid=$process.Id; ExitCode=$process.ExitCode; TimedOut=$timedOut; DurationSeconds=$duration; StdoutTail=(Get-SmokingpipesTextTail $stdout $TailCharacters); StderrTail=(Get-SmokingpipesTextTail $stderr $TailCharacters) }
    if ($timedOut) { Write-Host "[FAIL] $Stage timeout duration=${duration}s pid=$($process.Id)"; throw "$Stage timed out after $TimeoutSeconds seconds" }
    if ($result.ExitCode -ne 0) { Write-Host "[FAIL] $Stage exitCode=$($result.ExitCode) duration=${duration}s"; throw "$Stage failed with exit code $($result.ExitCode): $($result.StderrTail)$($result.StdoutTail)" }
    Write-Host "[PASS] $Stage duration=${duration}s pid=$($process.Id) exitCode=0"
    return $result
  } finally {
    foreach ($path in @($stdoutPath, $stderrPath)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
  }
}

Export-ModuleMember -Function Invoke-SmokingpipesCommand, Get-SmokingpipesTextTail
