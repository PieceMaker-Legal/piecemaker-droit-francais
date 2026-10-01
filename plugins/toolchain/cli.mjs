#!/usr/bin/env node
// node plugins/toolchain/cli.mjs            compile et installe tous les plugins
// node plugins/toolchain/cli.mjs --check    valide les manifestes sans rien écrire
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePlugin } from './build.mjs';
import { discoverPlugins, installPlugins } from './index.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  if (process.argv.includes('--check')) {
    const plugins = discoverPlugins(appRoot);
    for (const plugin of plugins) validatePlugin(plugin);
    console.log(`${plugins.length} plugins conformes : ${plugins.map((plugin) => plugin.id).join(', ')}`);
  } else {
    const result = await installPlugins({ appRoot, log: (plugin) => console.log(`compilé : ${plugin.label}`) });
    if (result.failed.length) process.exitCode = 1;
    console.log(result.installed.length ? `installés : ${result.installed.join(', ')}` : 'plugins déjà à jour');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
