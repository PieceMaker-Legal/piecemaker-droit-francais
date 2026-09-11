import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type PwaOutput = {
  log(message: string): void;
};

const DEFAULT_OUTPUT: PwaOutput = {
  log: (message) => console.log(message),
};

function configuredPort(): number {
  const value = Number.parseInt(process.env.SERVER_PORT || process.env.PORT || '3001', 10);
  return Number.isFinite(value) && value > 0 ? value : 3001;
}

function pwaUrl(): string {
  return process.env.PWA_URL || `http://localhost:${configuredPort()}`;
}

function pwaProfileDirectory(): string {
  return process.env.PWA_PROFILE_DIR || path.join(os.homedir(), '.piecemaker', 'pwa-profile');
}

function executableFromPath(command: string): string | null {
  try {
    return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}

function firstExisting(paths: string[]): string | null {
  return paths.find((candidate) => fs.existsSync(candidate)) || null;
}

function findChromiumExecutable(): string | null {
  if (process.platform === 'darwin') {
    return firstExisting([
      path.join('/Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      path.join('/Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
      path.join('/Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'),
      path.join('/Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      path.join(os.homedir(), 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
    ]);
  }

  if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
    ].filter((value): value is string => Boolean(value));
    const candidates = roots.flatMap((root) => [
      path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(root, 'Chromium', 'Application', 'chrome.exe'),
    ]);
    return firstExisting(candidates)
      || executableFromPath('chrome.exe')
      || executableFromPath('msedge.exe')
      || executableFromPath('brave.exe');
  }

  for (const command of ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'brave-browser', 'chromium', 'chromium-browser']) {
    const executable = executableFromPath(command);
    if (executable) return executable;
  }

  return null;
}

function serverIsReady(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const healthUrl = new URL('/health', url).toString();
    const request = http.get(healthUrl, { timeout: 1_000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function waitForServer(url: string): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await serverIsReady(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/** Starts PieceMaker in an isolated Chromium app window after its backend is ready. */
export async function launchPwa(output: PwaOutput = DEFAULT_OUTPUT): Promise<void> {
  const url = pwaUrl();
  if (!(await waitForServer(url))) {
    output.log(`[WARN] PieceMaker server did not become ready; open ${url} manually.`);
    return;
  }

  const browser = findChromiumExecutable();
  if (!browser) {
    output.log(`[WARN] No Chrome, Edge, Brave, or Chromium executable found; open ${url} manually.`);
    return;
  }

  const profileDirectory = pwaProfileDirectory();
  fs.mkdirSync(profileDirectory, { recursive: true });
  const child = spawn(browser, [`--app=${url}`, `--user-data-dir=${profileDirectory}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {
    output.log(`[WARN] Could not open the PieceMaker PWA; open ${url} manually.`);
  });
  child.unref();
  output.log(`[OK] PieceMaker PWA opened at ${url}`);
}
