#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadProductConfig } from '../../shared/product-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const stageDir = path.join(rootDir, '.desktop-build', 'desktop-app');
const product = loadProductConfig();

const packageJson = JSON.parse(
  await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
);

function getElectronVersion() {
  try {
    return JSON.parse(
      readFileSync(path.join(rootDir, 'node_modules', 'electron', 'package.json'), 'utf8'),
    ).version;
  } catch {
    try {
      return JSON.parse(
        readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'),
      ).packages['node_modules/electron'].version;
    } catch {
      throw new Error('Could not resolve an exact Electron version for desktop packaging.');
    }
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyRequired(relativePath) {
  const from = path.join(rootDir, relativePath);
  const to = path.join(stageDir, relativePath);
  if (!(await pathExists(from))) {
    throw new Error(`Required desktop build input is missing: ${relativePath}`);
  }
  await fs.cp(from, to, { recursive: true });
}

async function copyIfExists(relativePath) {
  const from = path.join(rootDir, relativePath);
  if (!(await pathExists(from))) return false;
  await fs.cp(from, path.join(stageDir, relativePath), { recursive: true });
  return true;
}

async function copyNodeModule(packageName) {
  const parts = packageName.split('/');
  const source = path.join(rootDir, 'node_modules', ...parts);
  if (!(await pathExists(source))) return false;

  const target = path.join(stageDir, 'node_modules', ...parts);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true });
  return true;
}

function buildDesktopPackageJson(copiedOptionalDependencies) {
  return {
    name: `${packageJson.name}-desktop`,
    version: packageJson.version,
    productName: product.name,
    description: `${product.name} desktop shell`,
    author: packageJson.author,
    license: packageJson.license,
    type: 'module',
    main: 'electron/main.js',
    dependencies: packageJson.dependencies,
    optionalDependencies: copiedOptionalDependencies,
    build: {
      appId: product.appId,
      productName: product.name,
      asar: packageJson.build.asar,
      artifactName: `${product.slug}-desktop-\${version}-\${os}-\${arch}.\${ext}`,
      electronVersion: getElectronVersion(),
      directories: {
        output: '../../release/desktop',
      },
      extraMetadata: {
        main: 'electron/main.js',
      },
      files: [
        'electron/**',
        'public/**',
        'dist/**',
        'dist-server/**',
        'shared/**',
        'product.config.json',
        'node_modules/**',
        'package.json',
      ],
      protocols: [{ name: product.name, schemes: [product.protocol] }],
      mac: {
        ...packageJson.build.mac,
        extendInfo: {
          ...packageJson.build.mac.extendInfo,
          CFBundleName: product.name,
          CFBundleDisplayName: product.name,
          CFBundleURLTypes: [{ CFBundleURLName: product.name, CFBundleURLSchemes: [product.protocol] }],
        },
      },
      win: packageJson.build.win,
      nsis: packageJson.build.nsis,
    },
  };
}

await fs.rm(stageDir, { recursive: true, force: true });
await fs.mkdir(stageDir, { recursive: true });

await copyRequired('electron');
await copyRequired('dist');
await copyRequired('public');
await copyRequired('product.config.json');
await copyRequired('shared/product-config.mjs');

const copiedOptionalDependencies = {};
for (const [name, version] of Object.entries(packageJson.optionalDependencies || {})) {
  if (await copyNodeModule(name)) {
    copiedOptionalDependencies[name] = version;
  }
}

for (const name of [
  '@nut-tree-fork/default-clipboard-provider',
  '@nut-tree-fork/libnut',
  '@nut-tree-fork/provider-interfaces',
  '@nut-tree-fork/shared',
  'jimp',
  'node-abort-controller',
  'temp',
]) {
  await copyNodeModule(name);
}

await fs.writeFile(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify(buildDesktopPackageJson(copiedOptionalDependencies), null, 2)}\n`,
  'utf8',
);

// Install the full dependency tree (including transitive deps and native
// bindings like better-sqlite3, bcrypt, node-pty) into the staged app.
// electron-builder packages whatever is on disk here, so this must be a
// complete, resolvable node_modules rather than a hand-picked subset.
console.log('Installing desktop app dependencies (npm install --omit=dev)…');
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: stageDir,
  stdio: 'inherit',
});

console.log(`Prepared thin desktop app at ${path.relative(rootDir, stageDir)}`);
if (Object.keys(copiedOptionalDependencies).length) {
  console.log(`Pre-copied optional dependencies: ${Object.keys(copiedOptionalDependencies).join(', ')}`);
}
