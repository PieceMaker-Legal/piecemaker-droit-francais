import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { windowsPowerShellEnvironment } from '../../../lib/shell.mjs';

test('system verifier loads the native API without requesting authentication', { skip: !['darwin', 'win32'].includes(process.platform) }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-system-'));
  try {
    let result;
    if (process.platform === 'darwin') {
      const executable = path.join(directory, 'verify-macos');
      const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`;
      execFileSync('xcrun', ['swiftc', '-target', target, fileURLToPath(new URL('./verify-macos.swift', import.meta.url)), '-o', executable], { timeout: 60000 });
      result = execFileSync(executable, ['--check'], { encoding: 'utf8' });
    } else {
      result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./verify-windows.ps1', import.meta.url)), '-Check'], { encoding: 'utf8', windowsHide: true, env: windowsPowerShellEnvironment('powershell.exe') });
    }
    assert.ok(['available', 'unavailable'].includes(result.trim()));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
