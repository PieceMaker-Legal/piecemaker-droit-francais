import os from 'node:os';
import path from 'node:path';

const PRODUCT_NAME = 'PieceMaker';

function pathFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function packagedApplicationRoot(appPath, platform = process.platform) {
  if (!appPath) return null;
  const paths = pathFor(platform);
  if (platform === 'darwin') {
    const root = paths.resolve(appPath, '..', '..', '..');
    return paths.basename(root) === `${PRODUCT_NAME}.app` ? root : null;
  }
  if (platform === 'win32') {
    const root = paths.resolve(appPath, '..', '..');
    return paths.basename(root) === PRODUCT_NAME ? root : null;
  }
  return null;
}

export function removalPlan(appRoot, home = os.homedir(), env = process.env, platform = process.platform) {
  const paths = pathFor(platform);
  const dataHome = env.PIECEMAKER_HOME || paths.join(home, '.piecemaker');
  const componentsHome = env.PIECEMAKER_COMPONENTS_HOME || dataHome;
  const shortcuts = platform === 'win32'
    ? [
      paths.join(env.APPDATA || paths.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT_NAME}.lnk`),
      paths.join(home, 'Desktop', `${PRODUCT_NAME}.lnk`),
    ]
    : [];
  return {
    appRoot,
    certificates: paths.join(dataHome, 'certs'),
    caCert: paths.join(dataHome, 'certs', 'piecemaker-ca.crt'),
    python: paths.join(componentsHome, 'python'),
    venv: paths.join(componentsHome, 'venv'),
    bootstrap: paths.join(dataHome, 'bootstrap'),
    keychain: paths.join(home, 'Library', 'Keychains', 'piecemaker-signing.keychain-db'),
    shortcuts,
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function macUninstallScript(plan) {
  return `#!/bin/sh
set -u
while kill -0 "$1" 2>/dev/null; do sleep 0.3; done
sleep 0.5
security remove-trusted-cert ${shellQuote(plan.caCert)} || true
keychain=$(security default-keychain -d user 2>/dev/null | tr -d ' "')
if [ -n "$keychain" ]; then
  security delete-certificate -c "PieceMaker Local CA" "$keychain" || true
fi
security delete-keychain ${shellQuote(plan.keychain)} || true
rm -rf ${shellQuote(plan.certificates)} ${shellQuote(plan.python)} ${shellQuote(plan.venv)} ${shellQuote(plan.bootstrap)}
rm -rf ${shellQuote(plan.appRoot)}
`;
}

export function windowsUninstallScript(plan) {
  const paths = [plan.certificates, plan.python, plan.venv, plan.bootstrap, ...plan.shortcuts, plan.appRoot];
  const removals = paths.map((target) => `Remove-Item -LiteralPath ${powershellQuote(target)} -Recurse -Force -ErrorAction SilentlyContinue`).join('\n');
  return `param([int]$ProcessId)
while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 300 }
Start-Sleep -Milliseconds 500
Get-ChildItem Cert:\\CurrentUser\\Root, Cert:\\CurrentUser\\TrustedPublisher, Cert:\\CurrentUser\\My |
  Where-Object { $_.Subject -match 'PieceMaker Local' } |
  Remove-Item -ErrorAction SilentlyContinue
${removals}
`;
}
