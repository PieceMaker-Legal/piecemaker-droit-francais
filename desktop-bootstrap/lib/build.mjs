import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';
import { ui } from './ui.mjs';
import { IS_MAC, PRODUCT_NAME } from './paths.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function findBuiltApp(sourceDir) {
  const releaseRoot = path.join(sourceDir, 'release', 'desktop');
  const entries = await fs.readdir(releaseRoot, { withFileTypes: true });

  for (const entry of entries.filter((item) => item.isDirectory())) {
    const dir = path.join(releaseRoot, entry.name);
    if (IS_MAC) {
      const inner = await fs.readdir(dir);
      const app = inner.find((name) => name.endsWith('.app'));
      if (app) return path.join(dir, app);
    } else if (entry.name.includes('unpacked')) {
      const executable = path.join(dir, `${PRODUCT_NAME}.exe`);
      if (await exists(executable)) return dir;
    }
  }

  throw new Error(`Aucune application construite trouvée dans ${releaseRoot}.`);
}

async function readPackageJson(target) {
  try {
    return JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function listInstalledPackages(modulesDir) {
  const packages = [];
  let entries;
  try {
    entries = await fs.readdir(modulesDir, { withFileTypes: true });
  } catch {
    return packages;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    if (entry.name.startsWith('@')) {
      const scoped = await fs.readdir(path.join(modulesDir, entry.name), { withFileTypes: true });
      for (const child of scoped.filter((item) => item.isDirectory())) {
        packages.push(path.join(modulesDir, entry.name, child.name));
      }
      continue;
    }
    packages.push(path.join(modulesDir, entry.name));
  }
  return packages;
}

async function findMissingDependencies(stageDir) {
  const modulesDir = path.join(stageDir, 'node_modules');
  const missing = new Map();

  for (const packageDir of await listInstalledPackages(modulesDir)) {
    const manifest = await readPackageJson(packageDir);
    if (!manifest?.dependencies) continue;

    const optional = new Set(Object.keys(manifest.optionalDependencies || {}));
    for (const [name, range] of Object.entries(manifest.dependencies)) {
      if (optional.has(name) || missing.has(name)) continue;
      const nested = path.join(packageDir, 'node_modules', name);
      const hoisted = path.join(modulesDir, name);
      if ((await exists(nested)) || (await exists(hoisted))) continue;
      missing.set(name, range);
    }
  }

  return [...missing].map(([name, range]) => `${name}@${range}`);
}

async function repairStagedTree(stageDir) {
  for (let pass = 0; pass < 4; pass += 1) {
    const missing = await findMissingDependencies(stageDir);
    if (missing.length === 0) return;
    ui.detail(`Dépendances manquantes complétées : ${missing.join(', ')}`);
    await run(npmCommand, ['install', '--no-save', '--omit=dev', '--no-audit', '--no-fund', ...missing], {
      cwd: stageDir,
    });
  }
  ui.warn("Certaines dépendances restent introuvables — electron-builder peut échouer.");
}

export async function buildDesktopApp(sourceDir) {
  ui.step('Installation des dépendances du projet (plusieurs minutes)…');
  await run(npmCommand, ['install', '--no-audit', '--no-fund'], { cwd: sourceDir });

  ui.step('Compilation du client et du serveur…');
  await run(npmCommand, ['run', 'build'], { cwd: sourceDir });

  ui.step("Préparation de l'application de bureau…");
  await run(npmCommand, ['run', 'desktop:stage'], { cwd: sourceDir });
  await repairStagedTree(path.join(sourceDir, '.desktop-build', 'desktop-app'));

  ui.step("Construction de l'application Electron…");
  await run('npx', ['electron-builder', '--projectDir', '.desktop-build/desktop-app', '--dir'], {
    cwd: sourceDir,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });

  const built = await findBuiltApp(sourceDir);
  ui.ok(`Application construite : ${built}`);
  return built;
}
