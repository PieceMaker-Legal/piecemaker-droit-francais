import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type ShortcutOutput = {
  log(message: string): void;
};

const SHORTCUT_NAME = 'PieceMaker';

function desktopDirectory(): string {
  return process.env.PIECEMAKER_DESKTOP_DIR || path.join(os.homedir(), 'Desktop');
}

function launchCommand(): { executable: string; argument: string } {
  return { executable: process.execPath, argument: process.argv[1] || '' };
}

function createMacShortcut(desktop: string): string | null {
  const { executable, argument } = launchCommand();
  if (!argument) return null;
  const bundle = path.join(desktop, `${SHORTCUT_NAME}.app`);
  if (fs.existsSync(bundle)) return null;

  const macOsDirectory = path.join(bundle, 'Contents', 'MacOS');
  fs.mkdirSync(macOsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${SHORTCUT_NAME}</string>
  <key>CFBundleIdentifier</key><string>legal.piecemaker.launcher</string>
  <key>CFBundleExecutable</key><string>${SHORTCUT_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`,
  );

  const launcher = path.join(macOsDirectory, SHORTCUT_NAME);
  fs.writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(executable)} ${JSON.stringify(argument)} start\n`);
  fs.chmodSync(launcher, 0o755);
  return bundle;
}

function createWindowsShortcut(desktop: string): string | null {
  const { executable, argument } = launchCommand();
  if (!argument) return null;
  const shortcut = path.join(desktop, `${SHORTCUT_NAME}.lnk`);
  if (fs.existsSync(shortcut)) return null;

  const script = [
    '$shell = New-Object -ComObject WScript.Shell',
    `$shortcut = $shell.CreateShortcut(${JSON.stringify(shortcut)})`,
    `$shortcut.TargetPath = ${JSON.stringify(executable)}`,
    `$shortcut.Arguments = ${JSON.stringify(`${JSON.stringify(argument)} start`)}`,
    `$shortcut.WorkingDirectory = ${JSON.stringify(path.dirname(executable))}`,
    '$shortcut.WindowStyle = 7',
    `$shortcut.Description = ${JSON.stringify('Ouvre PieceMaker')}`,
    '$shortcut.Save()',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
  return shortcut;
}

/**
 * Creates the PieceMaker desktop icon once, right after a fresh install, so the
 * application can be reopened without a terminal. Existing shortcuts are left
 * untouched and any failure is reported without interrupting the launch.
 */
export function ensureDesktopShortcut(output: ShortcutOutput): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;

  const desktop = desktopDirectory();
  if (!fs.existsSync(desktop)) return;

  try {
    const created = process.platform === 'darwin'
      ? createMacShortcut(desktop)
      : createWindowsShortcut(desktop);
    if (created) output.log(`[OK] PieceMaker desktop icon created at ${created}`);
  } catch {
    output.log('[WARN] Could not create the PieceMaker desktop icon.');
  }
}
