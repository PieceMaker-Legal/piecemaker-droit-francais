import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createRuntimeResolver({ packedRoot, physicalRoot, moduleRoots = [] }) {
  const packedParent = pathToFileURL(path.join(packedRoot, '.runtime-entry.mjs')).href;
  const componentParents = moduleRoots.map((root) => pathToFileURL(path.join(root, '..', '.runtime-entry.mjs')).href);
  let resolvingFallback = false;
  const resolveFrom = (specifier, context, parentURL, nextResolve) => {
    if (context.conditions?.includes('require')) {
      return nextResolve(createRequire(parentURL).resolve(specifier), context);
    }
    return nextResolve(specifier, { ...context, parentURL });
  };
  return (specifier, context, nextResolve) => {
    if (resolvingFallback) return nextResolve(specifier, context);
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)
        || /^(?:[./\\]|[a-z]+:)/i.test(specifier)) throw error;
      resolvingFallback = true;
      try {
        for (const parentURL of componentParents) {
          try {
            return resolveFrom(specifier, context, parentURL, nextResolve);
          } catch (candidateError) {
            if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(candidateError.code)) throw candidateError;
          }
        }
        const parentPath = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : '';
        const relative = path.relative(physicalRoot, parentPath);
        if (parentPath && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
          return resolveFrom(specifier, context, pathToFileURL(path.join(packedRoot, relative)).href, nextResolve);
        }
        try {
          return resolveFrom(specifier, context, packedParent, nextResolve);
        } catch {
          throw error;
        }
      } finally {
        resolvingFallback = false;
      }
    }
  };
}

export function registerRuntimeModules({ packedRoot, physicalRoot, moduleRoots = [] }) {
  return registerHooks({ resolve: createRuntimeResolver({ packedRoot, physicalRoot, moduleRoots }) });
}

export function configureRuntimeEnvironment({ packedRoot, physicalRoot, moduleRoots = [], environment = process.env }) {
  const preload = pathToFileURL(path.join(physicalRoot, 'electron-piecemaker', 'asar-runtime.mjs')).href;
  const importOption = `--import=${preload}`;
  environment.PIECEMAKER_PACKED_APP_ROOT = packedRoot;
  environment.PIECEMAKER_PHYSICAL_APP_ROOT = physicalRoot;
  environment.PIECEMAKER_COMPONENT_MODULE_ROOTS = JSON.stringify(moduleRoots);
  if (!(environment.NODE_OPTIONS || '').includes(importOption)) {
    environment.NODE_OPTIONS = `${environment.NODE_OPTIONS || ''} ${importOption}`.trim();
  }
  environment.ELECTRON_SERVER_ENTRY ||= path.join(physicalRoot, 'dist-server', 'server', 'index.js');
}

if (process.versions.electron && process.env.PIECEMAKER_PACKED_APP_ROOT) {
  const packedRoot = process.env.PIECEMAKER_PACKED_APP_ROOT;
  const physicalRoot = process.env.PIECEMAKER_PHYSICAL_APP_ROOT;
  if (!physicalRoot || !fs.existsSync(path.join(physicalRoot, 'package.json'))) {
    throw new Error('Le paquet physique PieceMaker est introuvable.');
  }
  registerRuntimeModules({
    packedRoot,
    physicalRoot,
    moduleRoots: JSON.parse(process.env.PIECEMAKER_COMPONENT_MODULE_ROOTS || '[]'),
  });
}
