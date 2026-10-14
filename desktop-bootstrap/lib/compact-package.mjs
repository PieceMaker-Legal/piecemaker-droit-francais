import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { selectRuntimeDependencies } from './runtime-dependencies.mjs';

const EXTERNAL_PACKAGES = [
  'better-sqlite3', 'bcrypt', 'express', 'mime', 'node-pty', '@nut-tree-fork/nut-js',
  'screenshot-desktop', '@vscode/ripgrep', '@modelcontextprotocol/sdk',
];

async function physicalPackageDirectories(stageDir, names) {
  const visited = new Set();
  async function visit(name, parent) {
    const require = createRequire(path.join(parent, 'package.json'));
    let directory;
    let manifest;
    for (const modules of require.resolve.paths(name) || []) {
      try {
        const candidate = path.join(modules, ...name.split('/'));
        const found = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf8'));
        if (found.name === name) {
          manifest = found;
          directory = candidate;
          break;
        }
      } catch {}
    }
    if (!manifest || visited.has(directory)) return;
    const relative = path.relative(stageDir, directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Dépendance hors du stage : ${name}`);
    visited.add(directory);
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      await visit(dependency, directory);
    }
  }
  for (const name of names) await visit(name, stageDir);
  return [...visited].map((directory) => `${path.relative(stageDir, directory).split(path.sep).join('/')}/**`);
}

export async function pruneDesktopDependencies(sourceDir, stageDir, npm) {
  const manifestFile = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const runtime = selectRuntimeDependencies(sourceDir, manifest);
  const before = Object.keys(manifest.dependencies || {});
  manifest.dependencies = runtime.dependencies;
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  await npm(['prune', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stageDir });
  return before.filter((name) => !(name in runtime.dependencies));
}

export async function configureCompactPackage(stageDir) {
  const manifestFile = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const externalAssets = selectRuntimeDependencies(stageDir, manifest, { sourceRoots: ['server'], includePluginServers: false });
  const physicalPackages = await physicalPackageDirectories(stageDir, [...EXTERNAL_PACKAGES, ...Object.keys(externalAssets.dependencies)]);
  manifest.build.asar = true;
  manifest.build.asarUnpack = [
    'package.json', 'product.config.json', 'shared/**', 'dist-server/**', 'dist/**', 'public/**',
    'server/**', 'piecemaker-plugins/**', 'runtime-components.json',
    'electron-piecemaker/asar-runtime.mjs', '**/*.node', '**/*.exe', '**/*.dll',
    ...physicalPackages,
  ];
  manifest.build.files.push('runtime-components.json');
  manifest.build.files.push('!**/*.test.*', '!**/*.spec.*');
  manifest.build.nsis.differentialPackage = true;
  const include = new URL('./update-timings.nsh', import.meta.url);
  await fs.copyFile(include, path.join(stageDir, 'update-timings.nsh'));
  manifest.build.nsis.include = 'update-timings.nsh';
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
