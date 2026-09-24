import os from 'node:os';
import path from 'node:path';

const PRODUCT_NAME = 'PieceMaker';
const COMPONENT_MODEL_IDS = [
  'fastino/gliner2.5-multi-v1',
  'fastino/gliner2-multi-v1',
  'opendatalab/PDF-Extract-Kit-1.0',
];

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

function underHome(target, home, platform) {
  const paths = pathFor(platform);
  const resolved = paths.resolve(target);
  const root = paths.resolve(home);
  if (resolved === root) return false;
  const relative = paths.relative(root, resolved);
  return relative !== '' && !relative.startsWith('..') && !paths.isAbsolute(relative);
}

export function hubDirectory(home, env, platform) {
  const paths = pathFor(platform);
  const hfHome = env.HF_HOME || paths.join(home, '.cache', 'huggingface');
  return env.HUGGINGFACE_HUB_CACHE || env.HF_HUB_CACHE || paths.join(hfHome, 'hub');
}

export function modelRepoDirectory(hub, modelId, platform) {
  return pathFor(platform).join(hub, `models--${String(modelId).replace(/\//g, '--')}`);
}

export function repoRootFromModelPath(modelPath, platform) {
  const paths = pathFor(platform);
  let current = paths.resolve(modelPath);
  for (let depth = 0; depth < 8; depth += 1) {
    if (paths.basename(current).startsWith('models--')) return current;
    const parent = paths.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export function componentModelPaths(home, env, platform, mineruConfig) {
  const paths = pathFor(platform);
  const hub = hubDirectory(home, env, platform);
  const found = new Set();
  for (const modelId of COMPONENT_MODEL_IDS) {
    const directory = modelRepoDirectory(hub, modelId, platform);
    if (underHome(directory, home, platform)) found.add(paths.resolve(directory));
  }
  const listed = mineruConfig?.['models-dir'];
  if (listed && typeof listed === 'object') {
    for (const value of Object.values(listed)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const repo = repoRootFromModelPath(value, platform);
      if (repo && underHome(repo, home, platform)) found.add(paths.resolve(repo));
    }
  }
  return [...found];
}

function safeNamedDirectory(candidate, home, platform, fallback, basename) {
  if (typeof candidate !== 'string' || !candidate.trim()) return fallback;
  const paths = pathFor(platform);
  const resolved = paths.resolve(candidate);
  if (paths.basename(resolved) !== basename || !underHome(resolved, home, platform)) return fallback;
  return resolved;
}

export function removalPlan(appRoot, home = os.homedir(), env = process.env, platform = process.platform, extra = {}) {
  const paths = pathFor(platform);
  const dataHome = env.PIECEMAKER_HOME || paths.join(home, '.piecemaker');
  const componentsHome = env.PIECEMAKER_COMPONENTS_HOME || dataHome;
  const shortcuts = platform === 'win32'
    ? [
      paths.join(env.APPDATA || paths.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT_NAME}.lnk`),
      paths.join(home, 'Desktop', `${PRODUCT_NAME}.lnk`),
    ]
    : [];
  const fallbackVenv = paths.join(componentsHome, 'venv');
  return {
    appRoot,
    certificates: paths.join(dataHome, 'certs'),
    caCert: paths.join(dataHome, 'certs', 'piecemaker-ca.crt'),
    python: paths.join(componentsHome, 'python'),
    venv: safeNamedDirectory(extra.config?.venvPath, home, platform, fallbackVenv, 'venv'),
    bootstrap: paths.join(dataHome, 'bootstrap'),
    keychain: paths.join(home, 'Library', 'Keychains', 'piecemaker-signing.keychain-db'),
    mineruConfig: paths.join(home, 'mineru.json'),
    models: componentModelPaths(home, env, platform, extra.mineru),
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
${plan.models.length ? `rm -rf ${plan.models.map(shellQuote).join(' ')}\n` : ''}rm -f ${shellQuote(plan.mineruConfig)}
rm -rf ${shellQuote(plan.appRoot)}
`;
}

export function windowsUninstallScript(plan) {
  const paths = [plan.certificates, plan.python, plan.venv, plan.bootstrap, plan.mineruConfig, ...plan.models, ...plan.shortcuts, plan.appRoot];
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
