import fs from 'node:fs/promises';
import path from 'node:path';
import { PRODUCT_NAME } from './paths.mjs';
import { ui } from './ui.mjs';

export const NODE_SHIM_DIR = 'node-shim';

export function nodeShimScript(executable = `${PRODUCT_NAME}.exe`) {
  return ['@echo off', 'setlocal', 'set ELECTRON_RUN_AS_NODE=1', `"%~dp0..\\..\\${executable}" %*`, ''].join('\r\n');
}

export async function embedNodeShim(stageDir) {
  const destination = path.join(stageDir, NODE_SHIM_DIR);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'node.cmd'), nodeShimScript());

  const manifestPath = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const extraResources = (manifest.build.extraResources || []).filter((entry) => entry?.to !== NODE_SHIM_DIR);
  manifest.build.extraResources = [...extraResources, { from: NODE_SHIM_DIR, to: NODE_SHIM_DIR }];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  ui.detail(`Commande node embarquée (${PRODUCT_NAME}.exe en mode Node).`);
}
