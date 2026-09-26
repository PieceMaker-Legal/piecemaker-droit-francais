import { spawn } from 'node:child_process';

import { loadProductConfig } from '../../../shared/product-config.mjs';

import { createDesktopUpdateRouter } from './routes.js';
import { createDesktopUpdateService } from './service.js';

function runInstaller(command: string, environment: NodeJS.ProcessEnv) {
  return new Promise<{ exitCode: number | null; output: string; errorOutput: string }>((resolve, reject) => {
    const child = spawn('sh', ['-c', command], { env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

function productRepository(): string | null {
  try {
    return loadProductConfig().repository;
  } catch {
    return null;
  }
}

function launchDetached(command: string) {
  spawn('sh', ['-c', command], { detached: true, stdio: 'ignore' }).unref();
}

export function createPieceMakerDesktopUpdateRouter(appRoot: string) {
  return createDesktopUpdateRouter(createDesktopUpdateService({
    appRoot,
    platform: process.platform,
    repository: productRepository(),
    applicationPid: process.ppid,
    environment: process.env,
    runInstaller,
    launchDetached,
    logInfo: (message) => console.log('[desktop-update]', message),
  }));
}
