#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|createRequire\([^)]*\)\s*\(\s*)['"](\.\.?\/[^'"]+\.[cm]?js)['"]/g;

function scripts(folder) {
  return fs.readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

export function completeDistServer(sourceRoot, distRoot) {
  const copied = [];
  const pending = scripts(distRoot);
  while (pending.length) {
    const file = pending.pop();
    for (const [, specifier] of fs.readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const target = path.resolve(path.dirname(file), specifier);
      if (fs.existsSync(target)) continue;
      const source = path.join(sourceRoot, path.relative(distRoot, target));
      if (!fs.existsSync(source)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      copied.push(path.relative(distRoot, target));
      pending.push(target);
    }
  }
  return copied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const copied = completeDistServer(root, path.resolve(root, process.argv[2] ?? 'dist-server'));
  for (const file of copied) console.log(`dist-server : ${file} ajouté depuis les sources.`);
}
