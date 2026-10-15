import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configureRuntimeEnvironment, registerRuntimeModules } from './asar-runtime.mjs';
import { ensureRuntimeComponents } from './runtime-components.mjs';

function initialPreparationNeeded() {
  const home = process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    return !config.pythonPath || !fs.existsSync(config.pythonPath) || !fs.existsSync(path.join(home, 'certs', 'piecemaker-ca.crt')) || !fs.existsSync(path.join(home, 'certs', 'piecemaker-ca.key'));
  } catch {
    return true;
  }
}

export async function initializeCompactRuntime({ app, LocalServerController, applicationRoot, createProgress }) {
  let moduleRoots = [];
  if (!app.isPackaged || !applicationRoot.endsWith('.asar')) return { applicationRoot, moduleRoots };
  const packedRoot = applicationRoot;
  const physicalRoot = `${packedRoot}.unpacked`;
  const manifest = JSON.parse(fs.readFileSync(path.join(physicalRoot, 'runtime-components.json'), 'utf8'));
  const cacheRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PieceMaker', 'runtime-components');
  let progress;
  let runtime;
  try {
    const preparingInitial = initialPreparationNeeded() && fs.existsSync(path.join(physicalRoot, 'desktop-bootstrap/lib/prepare-installed.mjs'));
    if (preparingInitial) progress ||= createProgress?.();
    const preparation = preparingInitial
      ? import(pathToFileURL(path.join(physicalRoot, 'desktop-bootstrap/lib/prepare-installed.mjs')).href).then(({ prepareInstalledDesktop }) => prepareInstalledDesktop({ applicationRoot: physicalRoot, includeProviders: false }))
      : Promise.resolve();
    [runtime] = await Promise.all([ensureRuntimeComponents({ manifest, cacheRoot, log: (message) => {
      console.log(`[PieceMaker] ${message}`);
      if (message.toLowerCase().includes('download')) progress ||= createProgress?.();
    } }), preparation]);
  } finally {
    progress?.destroy();
  }
  moduleRoots = runtime.moduleRoots;
  configureRuntimeEnvironment({ packedRoot, physicalRoot, moduleRoots });
  registerRuntimeModules({ packedRoot, physicalRoot, moduleRoots });
  const resolveServerEntry = LocalServerController.prototype.resolveServerEntry;
  LocalServerController.prototype.resolveServerEntry = function () {
    this.appRoot = physicalRoot;
    return resolveServerEntry.call(this);
  };
  return { applicationRoot: physicalRoot, moduleRoots };
}

export function portablePluginRuntime({ applicationRoot, moduleRoots = [], nodePath = process.execPath }) {
  const roots = [applicationRoot, ...moduleRoots.map((root) => path.dirname(root))];
  const codexLauncher = roots.map((root) => path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')).find((file) => fs.existsSync(file)) || null;
  return {
    nodePath,
    applicationRoot,
    electronRunAsNode: true,
    claudePath: null,
    codexPath: null,
    codexLauncher,
    vibePath: null,
  };
}
