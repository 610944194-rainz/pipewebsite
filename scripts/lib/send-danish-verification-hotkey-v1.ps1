param([int]$VirtualKey = 57, [switch]$Control, [switch]$Shift, [switch]$Alt)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$appId = 'da862615-e45a-4878-bd1a-2f74b7b0e30d'
$shellProcess = Get-Process ShadowBot.Shell -ErrorAction Stop | Where-Object { $_.SessionId -eq (Get-Process -Id $PID).SessionId } | Select-Object -First 1
if (-not $shellProcess) { throw 'ShadowBot is not running in the Danish session' }
$cli = Join-Path (Split-Path $shellProcess.Path) 'shadowbot.shell-cli.exe'
function Read-History {
  $result = (& $cli console task history --page-size 50 | Out-String | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or -not $result.ok) { throw 'ShadowBot history query failed' }
  return @($result.data.items | Where-Object { $_.appId -eq $appId })
}
$before = @(Read-History | ForEach-Object { $_.taskId })
Add-Type -TypeDefinition @'
using System;
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
  public static void Send(ushort[] keys) {
    INPUT[] inputs = new INPUT[keys.Length * 2];
    for (int i=0; i<keys.Length; i++) {
      inputs[i].type=1; inputs[i].data.keyboard.vk=keys[i];
      int j=inputs.Length-1-i; inputs[j].type=1; inputs[j].data.keyboard.vk=keys[i]; inputs[j].data.keyboard.flags=2;
    }
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
      throw new Exception("SendInput failed: " + Marshal.GetLastWin32Error());
  }
}
'@
$keys = @()
if ($Control) { $keys += 0x11 }
if ($Shift) { $keys += 0x10 }
if ($Alt) { $keys += 0x12 }
$keys += $VirtualKey
[DanishHotkeyInput]::Send([ushort[]]$keys)
$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
  Start-Sleep -Milliseconds 500
  $newTask = Read-History | Where-Object { $_.taskId -notin $before } | Select-Object -First 1
  if ($newTask) {
    $newTask | ConvertTo-Json -Compress
    if ($newTask.statusName -in @('faulted', 'canceled')) { exit 1 }
    exit 0
  }
} while ([DateTime]::UtcNow -lt $deadline)
throw 'shadowbot-task-not-confirmed: no new Danish task after SendInput'
