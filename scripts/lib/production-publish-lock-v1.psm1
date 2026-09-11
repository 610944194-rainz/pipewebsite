$script:DefaultProductionPublishLockPath = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
  $null
} else {
  "/srv/yandoubuy/state/publisher/production-publish.lock"
}

function Get-ProductionPublishLockPath {
  param([string]$Path = "")
  if ($Path) { return $Path }
  if ($env:PRODUCTION_PUBLISH_LOCK_PATH) { return $env:PRODUCTION_PUBLISH_LOCK_PATH }
  return $script:DefaultProductionPublishLockPath
}

function Add-ProcessArgument {
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.ProcessStartInfo]$StartInfo,
    [Parameter(Mandatory = $true)][string]$Value
  )
  if ($StartInfo.PSObject.Properties.Name -contains "ArgumentList") {
    [void]$StartInfo.ArgumentList.Add($Value)
    return
  }
  $escaped = $Value.Replace('\\', '\\\\').Replace('"', '\\"')
  $StartInfo.Arguments += " `"$escaped`""
}

function Acquire-ProductionPublishLock {
  param(
    [string]$Path = "",
    [int]$WaitSeconds = 0
  )

  if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    return [pscustomobject]@{ Noop = $true; Process = $null; Path = $null }
  }

  $lockPath = Get-ProductionPublishLockPath -Path $Path
  if (-not $lockPath) { throw "production publish lock path is not configured" }
  if ($WaitSeconds -le 0) {
    $WaitSeconds = if ($env:PRODUCTION_PUBLISH_LOCK_WAIT_SECONDS) {
      [int]$env:PRODUCTION_PUBLISH_LOCK_WAIT_SECONDS
    } else { 300 }
  }
  $directory = Split-Path -Parent $lockPath
  if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }

  $flock = Get-Command flock -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $parentPid = $PID
  $holderScript = "parent=$parentPid; printf '%s\n' acquired; while kill -0 `$parent 2>/dev/null; do sleep 1; done"
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $flock.Source
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  Add-ProcessArgument -StartInfo $startInfo -Value "-w"
  Add-ProcessArgument -StartInfo $startInfo -Value ([string]$WaitSeconds)
  Add-ProcessArgument -StartInfo $startInfo -Value $lockPath
  Add-ProcessArgument -StartInfo $startInfo -Value "/bin/sh"
  Add-ProcessArgument -StartInfo $startInfo -Value "-c"
  Add-ProcessArgument -StartInfo $startInfo -Value $holderScript
  Add-ProcessArgument -StartInfo $startInfo -Value "production-publish-lock"

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "unable to start flock for production publish lock" }
  $lineTask = $process.StandardOutput.ReadLineAsync()
  $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds + 5)
  while (-not $lineTask.IsCompleted) {
    if ($process.HasExited) {
      $stderr = $process.StandardError.ReadToEnd()
      $process.Dispose()
      throw "publisher-lock-timeout after ${WaitSeconds}s; $stderr"
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      try { $process.Kill() } catch {}
      $process.WaitForExit()
      $stderr = $process.StandardError.ReadToEnd()
      $process.Dispose()
      throw "publisher-lock-timeout after ${WaitSeconds}s; $stderr"
    }
    Start-Sleep -Milliseconds 50
  }
  $line = $lineTask.Result
  if ($line -ne "acquired") {
    try { $process.Kill() } catch {}
    $process.WaitForExit()
    $stderr = $process.StandardError.ReadToEnd()
    $process.Dispose()
    throw "publisher-lock-acquire-failed: $line $stderr"
  }
  return [pscustomobject]@{ Noop = $false; Process = $process; Path = $lockPath }
}

function Release-ProductionPublishLock {
  param([object]$Lock)
  if (-not $Lock -or $Lock.Noop) { return }
  $process = $Lock.Process
  if ($process) {
    try {
      if (-not $process.HasExited) { $process.Kill() }
      $process.WaitForExit(5000)
    } catch {}
    try { $process.Dispose() } catch {}
  }
}

Export-ModuleMember -Function Get-ProductionPublishLockPath, Acquire-ProductionPublishLock, Release-ProductionPublishLock
