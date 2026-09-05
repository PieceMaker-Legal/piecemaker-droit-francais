import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { APP, APP_URL, PIECEMAKER_HOME } from './config.mjs';
import { runCapture } from './exec.mjs';

const APPLICATION_NAME = 'PieceMaker';

function fetchStatus(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 4000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => {
      request.destroy();
      resolve({ status: 0, body: '' });
    });
    request.on('error', () => resolve({ status: 0, body: '' }));
  });
}

export async function verifyPwaAssets() {
  const manifest = await fetchStatus(`${APP_URL}/manifest.json`);
  const serviceWorker = await fetchStatus(`${APP_URL}/sw.js`);

  let manifestName = null;
  try {
    manifestName = JSON.parse(manifest.body).name || null;
  } catch {
    manifestName = null;
  }

  return {
    manifestServed: manifest.status === 200 && Boolean(manifestName),
    serviceWorkerServed: serviceWorker.status === 200 && serviceWorker.body.includes('addEventListener'),
    manifestName,
  };
}

function chromiumBrowser() {
  const candidates = [
    '/Applications/Google Chrome.app',
    '/Applications/Microsoft Edge.app',
    '/Applications/Brave Browser.app',
    '/Applications/Chromium.app',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function writeMacIcon(bundleResourcesDir) {
  const sourceIcon = path.join(APP.directory, 'public', 'logo-512.png');
  if (!fs.existsSync(sourceIcon)) return null;
  if (runCapture('which', ['iconutil']).code !== 0) return null;

  const iconsetDir = path.join(PIECEMAKER_HOME, 'cache', `${APPLICATION_NAME}.iconset`);
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });

  const sizes = [16, 32, 64, 128, 256, 512];
  for (const size of sizes) {
    runCapture('sips', ['-z', String(size), String(size), sourceIcon, '--out', path.join(iconsetDir, `icon_${size}x${size}.png`)]);
  }

  const icnsPath = path.join(bundleResourcesDir, `${APPLICATION_NAME}.icns`);
  const converted = runCapture('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath]);
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  return converted.code === 0 ? `${APPLICATION_NAME}.icns` : null;
}

function installMacApplication() {
  const applicationsDir = path.join(os.homedir(), 'Applications');
  const bundleDir = path.join(applicationsDir, `${APPLICATION_NAME}.app`);
  const macosDir = path.join(bundleDir, 'Contents', 'MacOS');
  const resourcesDir = path.join(bundleDir, 'Contents', 'Resources');

  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const browser = chromiumBrowser();
  const launchCommand = browser
    ? `open -na "${browser}" --args --app="${APP_URL}" --user-data-dir="$HOME/.piecemaker/pwa-profile"`
    : `open "${APP_URL}"`;

  const launcherPath = path.join(macosDir, APPLICATION_NAME);
  fs.writeFileSync(launcherPath, `#!/bin/sh\n/usr/bin/env piecemaker --launch-only >/dev/null 2>&1 &\nsleep 2\n${launchCommand}\n`, 'utf8');
  fs.chmodSync(launcherPath, 0o755);

  const iconFile = writeMacIcon(resourcesDir);
  const iconEntry = iconFile ? `  <key>CFBundleIconFile</key>\n  <string>${iconFile}</string>\n` : '';

  fs.writeFileSync(
    path.join(bundleDir, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>CFBundleName</key>\n  <string>${APPLICATION_NAME}</string>\n  <key>CFBundleDisplayName</key>\n  <string>${APPLICATION_NAME}</string>\n  <key>CFBundleIdentifier</key>\n  <string>legal.piecemaker.pwa</string>\n  <key>CFBundleExecutable</key>\n  <string>${APPLICATION_NAME}</string>\n  <key>CFBundlePackageType</key>\n  <string>APPL</string>\n  <key>CFBundleShortVersionString</key>\n  <string>1.0</string>\n${iconEntry}  <key>LSUIElement</key>\n  <false/>\n</dict>\n</plist>\n`,
    'utf8'
  );

  runCapture('touch', [bundleDir]);
  return { installed: true, location: bundleDir, standalone: Boolean(browser) };
}

function installLinuxApplication() {
  const applicationsDir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(applicationsDir, { recursive: true });
  const desktopFile = path.join(applicationsDir, 'piecemaker.desktop');

  fs.writeFileSync(
    desktopFile,
    `[Desktop Entry]\nType=Application\nName=${APPLICATION_NAME}\nComment=Plateforme IA pour juristes français\nExec=sh -c "piecemaker --launch-only >/dev/null 2>&1 & sleep 1; xdg-open ${APP_URL}"\nIcon=${path.join(APP.directory, 'public', 'logo-512.png')}\nCategories=Office;Legal;\nTerminal=false\n`,
    'utf8'
  );
  return { installed: true, location: desktopFile, standalone: false };
}

export function installApplicationEntry() {
  try {
    if (process.platform === 'darwin') return installMacApplication();
    if (process.platform === 'linux') return installLinuxApplication();
    return { installed: false, reason: 'plateforme non prise en charge' };
  } catch (error) {
    return { installed: false, reason: error.message };
  }
}

export function openApplication() {
  if (process.platform === 'darwin') {
    const browser = chromiumBrowser();
    if (browser) {
      runCapture('open', ['-na', browser, '--args', `--app=${APP_URL}`, `--user-data-dir=${path.join(os.homedir(), '.piecemaker', 'pwa-profile')}`]);
      return;
    }
    runCapture('open', [APP_URL]);
    return;
  }
  if (process.platform === 'linux') {
    runCapture('xdg-open', [APP_URL]);
    return;
  }
  runCapture('cmd', ['/c', 'start', '', APP_URL]);
}
