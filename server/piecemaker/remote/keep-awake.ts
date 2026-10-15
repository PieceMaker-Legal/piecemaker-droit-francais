import { spawn, type ChildProcess } from 'node:child_process';

export type KeepAwake = { start(): void; stop(): void; active(): boolean };

function windowsPowerShell(): string {
  return `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

function windowsKeepAwakeScript(pid: number): string {
  return `$ErrorActionPreference = 'Stop'
$watch = ${pid}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PieceMakerPower {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  [DllImport("kernel32.dll")] public static extern IntPtr PowerCreateRequest(IntPtr context);
  [DllImport("kernel32.dll")] public static extern bool PowerSetRequest(IntPtr handle, int type);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Reason { public uint Version; public uint Flags; public IntPtr Simple; }
  public static void Hold() {
    var reason = new Reason { Version = 0, Flags = 1, Simple = Marshal.StringToHGlobalUni("PieceMaker") };
    IntPtr ctx = Marshal.AllocHGlobal(Marshal.SizeOf(reason));
    Marshal.StructureToPtr(reason, ctx, false);
    IntPtr handle = PowerCreateRequest(ctx);
    if (handle != IntPtr.Zero && handle != new IntPtr(-1)) {
      PowerSetRequest(handle, 1);
      PowerSetRequest(handle, 3);
    }
    SetThreadExecutionState(0x80000001);
  }
}
'@
[PieceMakerPower]::Hold()
Wait-Process -Id $watch`;
}

export function keepAwakeCommand(platform: NodeJS.Platform = process.platform, pid: number = process.pid): [string, string[]] | null {
  if (platform === 'darwin') return ['caffeinate', ['-i', '-w', String(pid)]];
  if (platform === 'win32') {
    return [windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(windowsKeepAwakeScript(pid), 'utf16le').toString('base64')]];
  }
  return null;
}

export function createKeepAwake(): KeepAwake {
  let child: ChildProcess | null = null;
  return {
    start() {
      if (child) return;
      const command = keepAwakeCommand();
      if (!command) return;
      child = spawn(command[0], command[1], { stdio: 'ignore', windowsHide: true });
      child.on('error', () => { child = null; });
      child.on('exit', () => { child = null; });
    },
    stop() {
      child?.kill();
      child = null;
    },
    active: () => Boolean(child),
  };
}
