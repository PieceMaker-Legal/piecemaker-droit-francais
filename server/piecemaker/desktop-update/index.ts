import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { loadProductConfig } from '../../../shared/product-config.mjs';

import { createDesktopUpdateRouter } from './routes.js';
import { createDesktopUpdateService, type DesktopUpdateResult } from './service.js';

function runInstaller(command: string, environment: NodeJS.ProcessEnv) {
  return new Promise<{ exitCode: number | null; output: string; errorOutput: string }>((resolve, reject) => {
    const child = spawn('sh', ['-c', command], { cwd: os.homedir(), env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      console.log('[desktop-update]', chunk.toString().trimEnd());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
      console.error('[desktop-update]', chunk.toString().trimEnd());
    });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, output, errorOutput }));
  });
}

function productRepository(appRoot: string): string | null {
  try {
    return loadProductConfig(process.env.CLOUDCLI_PRODUCT_CONFIG || path.join(appRoot, 'product.config.json')).repository;
  } catch {
    return null;
  }
}

function launchDetached(command: string, environment: NodeJS.ProcessEnv = process.env) {
  if (process.platform === 'win32') {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: os.homedir(), env: environment, detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
    return;
  }
  spawn('sh', ['-c', command], { cwd: os.homedir(), env: environment, detached: true, stdio: 'ignore' }).unref();
}

export function createPieceMakerDesktopUpdateRouter(appRoot: string) {
  return createDesktopUpdateRouter(createDesktopUpdateService({
    appRoot,
    platform: process.platform,
    repository: productRepository(appRoot),
    applicationPid: process.ppid,
    environment: process.env,
    runInstaller,
    launchDetached,
    runWindowsUpdate: process.env.PIECEMAKER_DESKTOP_UPDATE_URL ? async () => {
      const endpoint = new URL(process.env.PIECEMAKER_DESKTOP_UPDATE_URL!);
      if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('Adresse de mise à jour locale invalide.');
      const response = await fetch(endpoint, { method: 'POST' });
      return await response.json() as DesktopUpdateResult;
    } : undefined,
    logInfo: (message) => console.log('[desktop-update]', message),
  }));
}
