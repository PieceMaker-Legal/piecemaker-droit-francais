import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { selectRuntimeDependencies } from './runtime-dependencies.mjs';

const EXTERNAL_PACKAGES = [
  'better-sqlite3', 'bcrypt', 'express', 'mime', 'node-pty',
  '@vscode/ripgrep', '@modelcontextprotocol/sdk',
];

async function physicalPackageDirectories(stageDir, names) {
  const visited = new Set();
  const unpackPatterns = new Set();
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
    unpackPatterns.add(`${relative.split(path.sep).join('/')}/**`);
    unpackPatterns.add(`node_modules/${name}/**`);
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      await visit(dependency, directory);
    }
  }
  for (const name of names) await visit(name, stageDir);
  return [...unpackPatterns];
}

export async function pruneDesktopDependencies(sourceDir, stageDir, npm) {
  const manifestFile = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const runtime = selectRuntimeDependencies(sourceDir, manifest);
  const before = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies });
  manifest.dependencies = runtime.dependencies;
  manifest.optionalDependencies = runtime.optionalDependencies;
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  await npm(['prune', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stageDir });
  return before.filter((name) => !(name in runtime.dependencies) && !(name in runtime.optionalDependencies));
}

export async function configureCompactPackage(stageDir) {
  const manifestFile = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const externalAssets = selectRuntimeDependencies(stageDir, manifest, { sourceRoots: ['server'], includePluginServers: false });
  const physicalPackages = await physicalPackageDirectories(stageDir, [...EXTERNAL_PACKAGES, ...Object.keys(externalAssets.dependencies)]);
  manifest.build.asar = true;
  manifest.build.asarUnpack = [
    'package.json', 'product.config.json', 'shared/**', 'dist-server/**', 'dist/**', 'public/**',
    'server/**', 'piecemaker-plugins/**', 'desktop-bootstrap/**', 'runtime-components.json', 'python-runtime.json',
    'electron-piecemaker/asar-runtime.mjs', 'electron-piecemaker/runtime-components.mjs', 'electron/uninstallPlan.js', '**/*.node', '**/*.exe', '**/*.dll',
    ...physicalPackages,
  ];
  manifest.build.files.push('runtime-components.json');
  manifest.build.files.push('!**/*.test.*', '!**/*.spec.*');
  manifest.build.files.push(
    '!**/node_modules/better-sqlite3/src/**',
    '!**/node_modules/better-sqlite3/deps/**',
    '!**/node_modules/better-sqlite3/build/**/*',
    '**/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    '!**/node_modules/pdf-lib/src/**',
    '!**/node_modules/pdf-lib/es/**',
    '!**/node_modules/pdf-lib/dist/**',
    '!**/node_modules/pdf-lib/ts3.4/**',
    '!**/node_modules/node-pty/src/**',
    '!**/node_modules/node-pty/third_party/**',
    '!**/node_modules/bcrypt/src/**',
    '!**/node_modules/bcrypt/prebuilds/darwin-*/**',
    '!**/node_modules/bcrypt/prebuilds/linux-*/**',
    '!**/node_modules/bcrypt/prebuilds/win32-arm64/**',
    '!**/node_modules/node-pty/prebuilds/darwin-*/**',
    '!**/node_modules/node-pty/prebuilds/linux-*/**',
    '!**/node_modules/node-pty/prebuilds/win32-arm64/**',
  );
  manifest.build.nsis.differentialPackage = true;
  const include = new URL('./update-timings.nsh', import.meta.url);
  await fs.copyFile(include, path.join(stageDir, 'update-timings.nsh'));
  manifest.build.nsis.include = 'update-timings.nsh';
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
