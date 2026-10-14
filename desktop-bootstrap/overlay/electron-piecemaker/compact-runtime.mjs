import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureRuntimeEnvironment, registerRuntimeModules } from './asar-runtime.mjs';
import { ensureRuntimeComponents } from './runtime-components.mjs';

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
    runtime = await ensureRuntimeComponents({ manifest, cacheRoot, log: (message) => {
      console.log(`[PieceMaker] ${message}`);
      if (message.toLowerCase().includes('download')) progress ||= createProgress?.();
    } });
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
