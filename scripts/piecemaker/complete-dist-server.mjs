#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|createRequire\([^)]*\)\s*\(\s*)(['"])(\.\.?\/[^'"]+\.[cm]?js)\2/g;

function scripts(folder) {
  return fs.readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

export function completeDistServer(sourceRoot, distRoot) {
  const redirected = [];
  for (const file of scripts(distRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(RELATIVE_IMPORT, (match, prefix, quote, specifier) => {
      const target = path.resolve(path.dirname(file), specifier);
      const source = path.join(sourceRoot, path.relative(distRoot, target));
      if (fs.existsSync(target) || !fs.existsSync(source)) return match;
      redirected.push(path.relative(distRoot, target));
      return `${prefix}${quote}${path.relative(path.dirname(file), source).split(path.sep).join('/')}${quote}`;
    });
    if (next !== text) fs.writeFileSync(file, next);
  }
  return redirected;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const redirected = completeDistServer(root, path.resolve(root, process.argv[2] ?? 'dist-server'));
  for (const file of redirected) console.log(`dist-server : ${file} chargé depuis les sources.`);
}
