import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function startCatalaPack({ app, applicationRoot, spawnProcess = spawn, exists = fs.existsSync, env = process.env, execPath = process.execPath }) {
  if (!app.isPackaged) return null;
  const script = path.join(applicationRoot, 'desktop-bootstrap', 'composants', 'catala.mjs');
  if (!exists(script)) return null;
  const child = spawnProcess(execPath, [script], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on?.('error', () => {});
  child.unref();
  return child;
}
