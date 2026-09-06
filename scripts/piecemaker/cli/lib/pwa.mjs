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

function macChromiumBrowser() {
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

function registerMacBundle(bundleDir) {
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  if (!fs.existsSync(lsregister)) return;
  runCapture(lsregister, ['-f', bundleDir]);
}

function writeMacDesktopAlias(bundleDir) {
  const desktopAlias = path.join(os.homedir(), 'Desktop', `${APPLICATION_NAME}.app`);
  try {
    fs.rmSync(desktopAlias, { recursive: true, force: true });
    fs.symlinkSync(bundleDir, desktopAlias);
    return desktopAlias;
  } catch {
    return null;
  }
}

function installMacApplication() {
  const applicationsDir = path.join(os.homedir(), 'Applications');
  const bundleDir = path.join(applicationsDir, `${APPLICATION_NAME}.app`);
  const macosDir = path.join(bundleDir, 'Contents', 'MacOS');
  const resourcesDir = path.join(bundleDir, 'Contents', 'Resources');

  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const browser = macChromiumBrowser();
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
  registerMacBundle(bundleDir);

  const desktopAlias = writeMacDesktopAlias(bundleDir);

  const locations = [bundleDir];
  if (desktopAlias) locations.push(desktopAlias);

  const bundleReady = fs.existsSync(launcherPath) && fs.existsSync(path.join(bundleDir, 'Contents', 'Info.plist'));
  const desktopReady = Boolean(desktopAlias) && fs.existsSync(desktopAlias);

  return {
    installed: true,
    location: bundleDir,
    locations,
    standalone: Boolean(browser),
    verified: bundleReady && desktopReady,
  };
}

function linuxDesktopEntryContent() {
  return `[Desktop Entry]\nType=Application\nName=${APPLICATION_NAME}\nComment=Plateforme IA pour juristes français\nExec=sh -c "piecemaker --launch-only >/dev/null 2>&1 & sleep 1; xdg-open ${APP_URL}"\nIcon=${path.join(APP.directory, 'public', 'logo-512.png')}\nCategories=Office;Legal;\nTerminal=false\n`;
}

function installLinuxApplication() {
  const applicationsDir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(applicationsDir, { recursive: true });
  const desktopFile = path.join(applicationsDir, 'piecemaker.desktop');
  const content = linuxDesktopEntryContent();

  fs.writeFileSync(desktopFile, content, 'utf8');
  const locations = [desktopFile];

  const desktopDir = path.join(os.homedir(), 'Desktop');
  let desktopShortcut = null;
  if (fs.existsSync(desktopDir)) {
    desktopShortcut = path.join(desktopDir, 'piecemaker.desktop');
    fs.writeFileSync(desktopShortcut, content, 'utf8');
    fs.chmodSync(desktopShortcut, 0o755);
    locations.push(desktopShortcut);
  }

  return {
    installed: true,
    location: desktopFile,
    locations,
    standalone: false,
    verified: locations.every((entry) => fs.existsSync(entry)),
  };
}

function encodePngAsIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

function writeWindowsIcon() {
  const sourceIcon = path.join(APP.directory, 'public', 'logo-512.png');
  if (!fs.existsSync(sourceIcon)) return null;

  const cacheDir = path.join(PIECEMAKER_HOME, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const icoPath = path.join(cacheDir, `${APPLICATION_NAME}.ico`);

  try {
    const pngBuffer = fs.readFileSync(sourceIcon);
    fs.writeFileSync(icoPath, encodePngAsIco(pngBuffer));
    return icoPath;
  } catch {
    return null;
  }
}

function windowsChromiumBrowser() {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';

  const candidates = [
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    localAppData && path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function windowsDesktopDir() {
  const standard = path.join(os.homedir(), 'Desktop');
  if (fs.existsSync(standard)) return standard;

  const oneDrive = process.env.OneDrive;
  if (oneDrive) {
    const oneDriveDesktop = path.join(oneDrive, 'Desktop');
    if (fs.existsSync(oneDriveDesktop)) return oneDriveDesktop;
  }

  return standard;
}

function windowsStartMenuDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

function createWindowsShortcut(shortcutPath, targetPath, shortcutArgs, iconPath) {
  const escape = (value) => String(value).replace(/'/g, "''");
  const lines = [
    '$shell = New-Object -ComObject WScript.Shell',
    `$shortcut = $shell.CreateShortcut('${escape(shortcutPath)}')`,
    `$shortcut.TargetPath = '${escape(targetPath)}'`,
    shortcutArgs ? `$shortcut.Arguments = '${escape(shortcutArgs)}'` : null,
    `$shortcut.WorkingDirectory = '${escape(path.dirname(targetPath))}'`,
    iconPath ? `$shortcut.IconLocation = '${escape(iconPath)}'` : null,
    '$shortcut.Save()',
  ].filter(Boolean);

  const scriptPath = path.join(os.tmpdir(), `piecemaker-shortcut-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');

  const result = runCapture('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& '${escape(scriptPath)}'`]);
  fs.rmSync(scriptPath, { force: true });

  return result.code === 0;
}

function installWindowsApplication() {
  const browser = windowsChromiumBrowser();
  const iconPath = writeWindowsIcon();
  const userDataDir = path.join(os.homedir(), '.piecemaker', 'pwa-profile');

  const targetPath = browser || path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe');
  const shortcutArgs = browser ? `--app=${APP_URL} --user-data-dir=${userDataDir}` : APP_URL;

  const desktopDir = windowsDesktopDir();
  const startMenuDir = windowsStartMenuDir();
  fs.mkdirSync(desktopDir, { recursive: true });
  fs.mkdirSync(startMenuDir, { recursive: true });

  const desktopShortcut = path.join(desktopDir, `${APPLICATION_NAME}.lnk`);
  const startMenuShortcut = path.join(startMenuDir, `${APPLICATION_NAME}.lnk`);

  createWindowsShortcut(desktopShortcut, targetPath, shortcutArgs, iconPath);
  createWindowsShortcut(startMenuShortcut, targetPath, shortcutArgs, iconPath);

  const locations = [desktopShortcut, startMenuShortcut].filter((candidate) => fs.existsSync(candidate));

  if (locations.length === 0) {
    return { installed: false, reason: "création du raccourci Windows impossible (PowerShell absent ou refusé)" };
  }

  return {
    installed: true,
    location: locations[0],
    locations,
    standalone: Boolean(browser),
    verified: locations.length === 2,
  };
}

export function installApplicationEntry() {
  try {
    if (process.platform === 'darwin') return installMacApplication();
    if (process.platform === 'linux') return installLinuxApplication();
    if (process.platform === 'win32') return installWindowsApplication();
    return { installed: false, reason: 'plateforme non prise en charge' };
  } catch (error) {
    return { installed: false, reason: error.message };
  }
}

export function openApplication() {
  if (process.platform === 'darwin') {
    const browser = macChromiumBrowser();
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
