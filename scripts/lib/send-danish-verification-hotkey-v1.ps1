param([int]$VirtualKey = 57, [switch]$Control, [switch]$Shift, [switch]$Alt, [switch]$TestOnly, [string]$TaskId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$appId = 'da862615-e45a-4878-bd1a-2f74b7b0e30d'
$shellProcess = Get-Process ShadowBot.Shell -ErrorAction Stop | Where-Object { $_.SessionId -eq (Get-Process -Id $PID).SessionId } | Select-Object -First 1
if (-not $shellProcess) { throw 'ShadowBot is not running in the Danish session' }
$cli = Join-Path (Split-Path $shellProcess.Path) 'shadowbot.shell-cli.exe'
function Read-History {
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo.FileName = $cli
  $process.StartInfo.Arguments = 'console task history --page-size 50'
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  $process.StartInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $process.StartInfo.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
  try {
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(10000)) { $process.Kill(); throw 'ShadowBot history query timeout' }
    $result = $stdout.GetAwaiter().GetResult() | ConvertFrom-Json
    if ($process.ExitCode -ne 0 -or -not $result.ok) { throw 'ShadowBot history query failed' }
  } finally { $process.Dispose() }
  return @($result.data.items | Where-Object { $_.appId -eq $appId })
}
if ($TaskId) {
  $task = Read-History | Where-Object { $_.taskId -eq $TaskId } | Select-Object -First 1
  if (-not $task) { throw 'ShadowBot Danish task not found' }
  @{ taskId = $task.taskId; status = $task.status; error = $task.error } | ConvertTo-Json -Compress
  exit 0
}
$before = @(Read-History | ForEach-Object { $_.taskId })
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DanishHotkeyInput {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION {
    [FieldOffset(0)] public KEYBDINPUT keyboard;
    [FieldOffset(0)] public MOUSEINPUT mouse;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort vk, scan; public uint flags, time; public UIntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra;
  }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] input, int size);
  public static INPUT[] BuildHotkeyInputs(bool control, bool shift, bool alt, int virtualKey) {
    if (virtualKey < 0 || virtualKey > ushort.MaxValue) {
      throw new ArgumentOutOfRangeException("virtualKey", "virtualKey must be between 0 and 65535.");
    }
    var keys = new List<ushort>();
    if (control) keys.Add((ushort)0x11);
    if (shift) keys.Add((ushort)0x10);
    if (alt) keys.Add((ushort)0x12);
    keys.Add((ushort)virtualKey);
    INPUT[] inputs = new INPUT[keys.Count * 2];
    for (int i=0; i<keys.Count; i++) {
      inputs[i].type=1; inputs[i].data.keyboard.vk=keys[i];
      int releaseIndex=inputs.Length-1-i;
      inputs[releaseIndex].type=1;
      inputs[releaseIndex].data.keyboard.vk=keys[i];
      inputs[releaseIndex].data.keyboard.flags=2;
    }
    return inputs;
  }
  public static int ValidateHotkey(bool control, bool shift, bool alt, int virtualKey) {
    return BuildHotkeyInputs(control, shift, alt, virtualKey).Length;
  }
  public static void SendHotkey(bool control, bool shift, bool alt, int virtualKey) {
    INPUT[] inputs = BuildHotkeyInputs(control, shift, alt, virtualKey);
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
      throw new Exception("SendInput failed: " + Marshal.GetLastWin32Error());
  }
}
'@
$inputCount = [DanishHotkeyInput]::ValidateHotkey([bool]$Control, [bool]$Shift, [bool]$Alt, [int]$VirtualKey)
if ($TestOnly) {
  @{ testOnly = $true; virtualKey = $VirtualKey; inputCount = $inputCount } | ConvertTo-Json -Compress
  exit 0
}
[DanishHotkeyInput]::SendHotkey([bool]$Control, [bool]$Shift, [bool]$Alt, [int]$VirtualKey)
$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
  Start-Sleep -Milliseconds 500
  $newTask = Read-History | Where-Object { $_.taskId -notin $before } | Select-Object -First 1
  if ($newTask) {
    $newTask | ConvertTo-Json -Compress
    exit 0
  }
} while ([DateTime]::UtcNow -lt $deadline)
throw 'shadowbot-task-not-confirmed: no new Danish task after SendInput'
