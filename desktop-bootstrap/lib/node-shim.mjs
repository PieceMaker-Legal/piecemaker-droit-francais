import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './shell.mjs';
import { ui } from './ui.mjs';

export const NODE_SHIM_DIR = 'node-shim';
export const NODE_SHIM_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'node-shim.cs');

function windowsCsc() {
  return path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
}

export async function embedNodeShim(stageDir) {
  const destination = path.join(stageDir, NODE_SHIM_DIR);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await run(windowsCsc(), ['/nologo', '/target:exe', `/out:${path.join(destination, 'node.exe')}`, NODE_SHIM_SOURCE], { windowsHide: true });

  const manifestPath = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const executableName = `${manifest.build.executableName || manifest.build.productName || 'PieceMaker'}.exe`;
  await fs.writeFile(path.join(destination, 'application.txt'), executableName, 'utf8');
  const extraResources = (manifest.build.extraResources || []).filter((entry) => entry?.to !== NODE_SHIM_DIR);
  manifest.build.extraResources = [...extraResources, { from: NODE_SHIM_DIR, to: NODE_SHIM_DIR }];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  ui.detail(`Commande node embarquée (${executableName} en mode Node).`);
}
