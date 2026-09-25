import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, run } from './shell.mjs';
import { ui } from './ui.mjs';
import { IS_MAC, PRODUCT_NAME } from './paths.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bootstrapRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

async function verifyBuiltApp(builtApp) {
  const appRoot = IS_MAC ? path.join(builtApp, 'Contents', 'Resources', 'app') : path.join(builtApp, 'resources', 'app');
  const binaryName = process.platform === 'win32' ? 'piecemaker-hudsucker.exe' : 'piecemaker-hudsucker';
  const required = [
    'dist-server/server/index.js',
    'server/piecemaker/vendor/websocket-server/originals-pipeline.cjs',
    `server/piecemaker/anonymizer/bin/${binaryName}`,
  ];
  const missing = [];
  for (const relativePath of required) {
    if (!(await exists(path.join(appRoot, relativePath)))) missing.push(relativePath);
  }
  if (missing.length) throw new Error(`Application construite incomplète — fichiers absents : ${missing.join(', ')}`);
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

const EXCLUDED_RUNTIME_ASSETS = new Set(['node_modules', '__pycache__', '.env', '.DS_Store', '.git', 'target', 'hudsucker-proxy']);

function isRuntimeAsset(target) {
  const name = path.basename(target);
  if (EXCLUDED_RUNTIME_ASSETS.has(name)) return false;
  return !name.endsWith('.ts');
}

async function embedRuntimeAssets(sourceDir, stageDir) {
  const from = path.join(sourceDir, 'server', 'piecemaker');
  const to = path.join(stageDir, 'server', 'piecemaker');
  await fs.rm(to, { recursive: true, force: true });
  await fs.cp(from, to, { recursive: true, filter: isRuntimeAsset });

  const probe = path.join(to, 'vendor', 'piecemaker-plugin', 'scripts', 'lib', 'verify-citations.cjs');
  if (!(await exists(probe))) {
    throw new Error(`Ressources PieceMaker incomplètes — ${probe} est absent.`);
  }

  ui.detail('Ressources PieceMaker non compilées embarquées.');
}

const OVERLAY_DIR = 'electron-piecemaker';
const OVERLAY_ENTRY = `${OVERLAY_DIR}/main.js`;
const ICON_DIR = 'server/piecemaker/vendor/installer/assets';
const PRODUCT_ICONS = { mac: `${ICON_DIR}/piecemaker.icns`, win: `${ICON_DIR}/piecemaker.ico` };

async function embedDesktopOverlay(stageDir) {
  const from = path.join(bootstrapRoot, 'overlay', OVERLAY_DIR);
  const to = path.join(stageDir, OVERLAY_DIR);
  await fs.rm(to, { recursive: true, force: true });
  await fs.cp(from, to, { recursive: true });
  ui.detail("Surcouche d'ouverture automatique embarquée.");
}

async function patchStagedManifest(stageDir) {
  const manifestPath = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  manifest.main = OVERLAY_ENTRY;
  manifest.build.extraMetadata = { ...manifest.build.extraMetadata, main: OVERLAY_ENTRY };
  for (const pattern of ['server/**', `${OVERLAY_DIR}/**`]) {
    if (!manifest.build.files.includes(pattern)) manifest.build.files.push(pattern);
  }

  for (const [platform, icon] of Object.entries(PRODUCT_ICONS)) {
    if (!(await exists(path.join(stageDir, icon)))) {
      throw new Error(`Icône ${PRODUCT_NAME} absente du stage : ${icon}.`);
    }
    manifest.build[platform] = { ...manifest.build[platform], icon };
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  ui.detail(`Icône ${PRODUCT_NAME} appliquée à l'application.`);
}

async function embedLocalServer(sourceDir, stageDir) {
  const from = path.join(sourceDir, 'dist-server');
  const entry = path.join(from, 'server', 'index.js');
  if (!(await exists(entry))) {
    throw new Error(`Serveur local absent (${entry}) — « npm run build:server » n'a rien produit.`);
  }
  const to = path.join(stageDir, 'dist-server');
  await fs.rm(to, { recursive: true, force: true });
  await fs.cp(from, to, { recursive: true });
  ui.detail('Serveur local embarqué dans l\'application.');
  await embedRuntimeAssets(sourceDir, stageDir);
}

function cargoHome() {
  const bootstrapHome = process.env.PIECEMAKER_BOOTSTRAP_HOME
    || path.join(os.homedir(), '.piecemaker', 'bootstrap');
  return path.join(bootstrapHome, 'toolchain', 'cargo');
}

async function ensureCargo() {
  if (capture('cargo', ['--version']).code === 0) return process.env;
  const home = cargoHome();
  const rustupHome = path.join(path.dirname(home), 'rustup');
  const cargoBin = path.join(home, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  const env = {
    ...process.env,
    CARGO_HOME: home,
    RUSTUP_HOME: rustupHome,
    PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
  };
  if (await exists(cargoBin)) return env;

  ui.step("Installation de Rust pour le proxy d'anonymisation…");
  if (process.platform === 'win32') {
    const installer = path.join(os.tmpdir(), 'piecemaker-rustup-init.exe');
    await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Invoke-WebRequest -UseBasicParsing -Uri https://win.rustup.rs/x86_64 -OutFile '${installer}'`,
    ]);
    await run(installer, ['-y', '--default-toolchain', 'stable', '--profile', 'minimal', '--no-modify-path'], { env });
  } else {
    await run('sh', ['-c', "curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path"], { env });
  }
  if (!(await exists(cargoBin))) throw new Error('Rust installé, mais cargo est introuvable.');
  return env;
}

async function buildAnonymizerProxy(sourceDir) {
  const env = await ensureCargo();
  const project = path.join(sourceDir, 'server', 'piecemaker', 'anonymizer', 'hudsucker-proxy');
  ui.step("Compilation du proxy d'anonymisation…");
  await run('cargo', ['build', '--release', '--manifest-path', path.join(project, 'Cargo.toml')], {
    cwd: sourceDir,
    env,
  });
  const binaryName = process.platform === 'win32' ? 'piecemaker-hudsucker.exe' : 'piecemaker-hudsucker';
  const built = path.join(project, 'target', 'release', binaryName);
  const destinationDir = path.join(sourceDir, 'server', 'piecemaker', 'anonymizer', 'bin');
  await fs.mkdir(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, binaryName);
  await fs.copyFile(built, destination);
  if (process.platform !== 'win32') await fs.chmod(destination, 0o755);
  ui.detail('Proxy d\'anonymisation embarqué.');
}

export async function buildDesktopApp(sourceDir) {
  ui.step('Installation des dépendances du projet (plusieurs minutes)…');
  await run(npmCommand, ['install', '--no-audit', '--no-fund'], { cwd: sourceDir });
  await buildAnonymizerProxy(sourceDir);

  ui.step('Compilation du client et du serveur…');
  await run(npmCommand, ['run', 'build'], { cwd: sourceDir });

  ui.step("Préparation de l'application de bureau…");
  await run(npmCommand, ['run', 'desktop:stage'], { cwd: sourceDir });
  const stageDir = path.join(sourceDir, '.desktop-build', 'desktop-app');
  await embedLocalServer(sourceDir, stageDir);
  await embedDesktopOverlay(stageDir);
  await patchStagedManifest(stageDir);
  await repairStagedTree(stageDir);

  ui.step("Construction de l'application Electron…");
  await run('npx', ['electron-builder', '--projectDir', '.desktop-build/desktop-app', '--dir'], {
    cwd: sourceDir,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });

  const built = await findBuiltApp(sourceDir);
  await verifyBuiltApp(built);
  ui.ok(`Application construite : ${built}`);
  return built;
}
