import assert from 'node:assert/strict';
import test from 'node:test';

import { capture, windowsPowerShellEnvironment } from './shell.mjs';

test('Windows PowerShell does not inherit the PowerShell 7 module path', () => {
  const environment = { PATH: 'C:\\Windows', PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules' };
  assert.deepEqual(windowsPowerShellEnvironment('powershell.exe', environment), { PATH: 'C:\\Windows' });
  assert.deepEqual(windowsPowerShellEnvironment('PowerShell', environment), { PATH: 'C:\\Windows' });
  assert.equal(windowsPowerShellEnvironment('pwsh.exe', environment), environment);
  assert.equal(windowsPowerShellEnvironment('git', environment), environment);
});

test('the certificate drive is available to Windows PowerShell started from PowerShell 7', { skip: process.platform !== 'win32' }, () => {
  const result = capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Test-Path Cert:\\CurrentUser\\Root'], {
    env: { ...process.env, PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules' },
  });
  assert.equal(result.stdout, 'True');
});
