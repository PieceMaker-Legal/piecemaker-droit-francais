import fs from 'node:fs/promises';
import path from 'node:path';
import { IS_MAC } from './paths.mjs';

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function verifyBuiltApp(builtApp) {
  const legacyRoot = IS_MAC ? path.join(builtApp, 'Contents', 'Resources', 'app') : path.join(builtApp, 'resources', 'app');
  const compactRoot = `${legacyRoot}.asar.unpacked`;
  const appRoot = await exists(path.join(compactRoot, 'package.json')) ? compactRoot : legacyRoot;
  const binaryName = process.platform === 'win32' ? 'piecemaker-hudsucker.exe' : 'piecemaker-hudsucker';
  const required = [
    'dist-server/server/index.js',
    'server/piecemaker/vendor/websocket-server/originals-pipeline.cjs',
    `server/piecemaker/anonymizer/bin/${binaryName}`,
  ];
  const missing = [];
  if (IS_MAC && !(await exists(path.join(builtApp, 'Contents', 'Resources', 'libreoffice', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')))) missing.push('Contents/Resources/libreoffice/LibreOffice.app/Contents/MacOS/soffice');
  for (const relativePath of required) {
    if (!(await exists(path.join(appRoot, relativePath)))) missing.push(relativePath);
  }
  if (process.platform === 'win32' && !(await exists(path.join(builtApp, 'resources', 'mingit', 'cmd', 'git.exe')))) missing.push('resources/mingit/cmd/git.exe');
  if (process.platform === 'win32' && !(await exists(path.join(builtApp, 'resources', 'node-shim', 'node.exe')))) missing.push('resources/node-shim/node.exe');
  if (process.platform === 'win32' && !(await exists(path.join(builtApp, 'resources', 'libreoffice', 'program', 'soffice.com')))) missing.push('resources/libreoffice/program/soffice.com');
  if (missing.length) throw new Error(`Application construite incomplète — fichiers absents : ${missing.join(', ')}`);
}

export async function verifyMacBundleLinks(bundle) {
  if ((await fs.lstat(bundle)).isSymbolicLink()) throw new Error("Lien hors de l'application dans l'archive");
  const root = await fs.realpath(bundle);
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = await fs.realpath(target);
        if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
          throw new Error("Lien hors de l'application dans l'archive");
        }
      } else if (entry.isDirectory()) await visit(target);
    }
  }
  await visit(bundle);
}
