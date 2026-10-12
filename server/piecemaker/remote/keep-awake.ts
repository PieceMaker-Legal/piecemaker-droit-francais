import { spawn, type ChildProcess } from 'node:child_process';

export type KeepAwake = { start(): void; stop(): void; active(): boolean };

const WINDOWS_SCRIPT = `Add-Type -Namespace PieceMaker -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'; [PieceMaker.Power]::SetThreadExecutionState(0x80000001) | Out-Null; Wait-Process -Id ${process.pid}`;

export function keepAwakeCommand(platform: NodeJS.Platform = process.platform, pid: number = process.pid): [string, string[]] | null {
  if (platform === 'darwin') return ['caffeinate', ['-i', '-w', String(pid)]];
  if (platform === 'win32') return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT]];
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
