import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { capture, run } from './shell.mjs';
import { BUNDLE_DIR, embedBundledPlugins } from './plugins.mjs';
import { ui } from './ui.mjs';
import { configureWindowsUpdates } from './windows-update-config.mjs';
import { pruneDesktopDependencies, configureCompactPackage } from './compact-package.mjs';
import { packageRuntimeComponents } from './components-package.mjs';
import { embedMinGit } from './mingit.mjs';
import { IS_MAC, PRODUCT_NAME, caCertPath, caKeyPath, releaseRepo, releaseTag } from './paths.mjs';

function npmTool(tool) {
  if (process.platform !== 'win32') return (args, options) => run(tool, args, options);
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${tool}-cli.js`);
  const shim = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'windows-npm-shim.mjs')).href;
  return async (args, options = {}) => {
    const baseEnv = options.env || process.env;
    const env = { ...baseEnv, NODE_OPTIONS: `${baseEnv.NODE_OPTIONS || ''} --import=${shim}`.trim() };
    if (await exists(cli)) return run(process.execPath, [cli, ...args], { ...options, env });
    return run(`${tool}.cmd`, args.map((arg) => `"${arg}"`), { ...options, env, shell: true });
  };
}

const npm = npmTool('npm');
const npx = npmTool('npx');
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
  for (const relativePath of required) {
    if (!(await exists(path.join(appRoot, relativePath)))) missing.push(relativePath);
  }
  if (process.platform === 'win32' && !(await exists(path.join(builtApp, 'resources', 'mingit', 'cmd', 'git.exe')))) missing.push('resources/mingit/cmd/git.exe');
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
  const visited = new Set();
  async function visit(modules) {
    if (visited.has(modules)) return;
    visited.add(modules);
    let entries;
    try {
      entries = await fs.readdir(modules, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.bin') continue;
      if (entry.name.startsWith('@')) {
        const scope = path.join(modules, entry.name);
        for (const child of await fs.readdir(scope, { withFileTypes: true })) {
          if (child.isDirectory()) {
            const packageDir = path.join(scope, child.name);
            packages.push(packageDir);
            await visit(path.join(packageDir, 'node_modules'));
          }
        }
        continue;
      }
      const packageDir = path.join(modules, entry.name);
      packages.push(packageDir);
      await visit(path.join(packageDir, 'node_modules'));
    }
  }
  await visit(modulesDir);
  return packages;
}

export async function findMissingDependencies(stageDir) {
  const modulesDir = path.join(stageDir, 'node_modules');
  const missing = new Map();

  for (const packageDir of await listInstalledPackages(modulesDir)) {
    const manifest = await readPackageJson(packageDir);
    if (!manifest?.dependencies) continue;

    const optional = new Set(Object.keys(manifest.optionalDependencies || {}));
    for (const [name, range] of Object.entries(manifest.dependencies)) {
      if (optional.has(name) || missing.has(name) || isBuiltin(name)) continue;
      const require = createRequire(path.join(packageDir, 'package.json'));
      const locations = require.resolve.paths(name) || [];
      const dependency = name.split('/');
      let installed = false;
      for (const location of locations) {
        const relative = path.relative(modulesDir, location);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
        if (await exists(path.join(location, ...dependency))) {
          installed = true;
          break;
        }
      }
      if (installed) continue;
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
    await npm(['install', '--no-save', '--omit=dev', '--no-audit', '--no-fund', ...missing], {
      cwd: stageDir,
    });
  }
  ui.warn("Certaines dépendances restent introuvables — electron-builder peut échouer.");
}

const EXCLUDED_RUNTIME_ASSETS = new Set(['node_modules', '__pycache__', '.env', '.DS_Store', '.git', 'target', 'hudsucker-proxy', 'tests']);
const TEST_FILE_PATTERN = /\.test\.[cm]?[jt]sx?(\.map)?$/;

function isShippedFile(target) {
  const name = path.basename(target);
  if (/\.(p12|pfx|key)$/i.test(name)) return false;
  return !EXCLUDED_RUNTIME_ASSETS.has(name) && !TEST_FILE_PATTERN.test(name);
}

const SKIP_RELATIVE_PREFIXES = ['vendor/piecemaker-plugin/skills', 'vendor/piecemaker-plugin/agents'];

function isRuntimeAsset(sourceRoot, target) {
  if (!isShippedFile(target) || path.basename(target).endsWith('.ts')) return false;
  const relative = path.relative(sourceRoot, target).split(path.sep).join('/');
  return !SKIP_RELATIVE_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

async function embedRuntimeAssets(sourceDir, stageDir) {
  const from = path.join(sourceDir, 'server', 'piecemaker');
  const to = path.join(stageDir, 'server', 'piecemaker');
  await fs.rm(to, { recursive: true, force: true });
  await fs.cp(from, to, { recursive: true, filter: (target) => isRuntimeAsset(from, target) });

  const probe = path.join(to, 'vendor', 'piecemaker-plugin', 'scripts', 'lib', 'verify-citations.cjs');
  const legifrance = path.join(to, 'vendor', 'mcp', 'legifrance', 'server.mjs');
  const docxCli = path.join(to, 'vendor', 'skills', 'docx-cli', 'SKILL.md');
  const pieceMakerSkill = path.join(to, 'vendor', 'skills', 'Skill-PieceMaker', 'SKILL.md');
  const redactionFrom = path.join(from, 'vendor', 'piecemaker-plugin', 'skills', 'redaction-juridique');
  const redactionTo = path.join(to, 'vendor', 'piecemaker-plugin', 'skills', 'redaction-juridique');
  if (!(await exists(probe))) {
    throw new Error(`Ressources PieceMaker incomplètes — ${probe} est absent.`);
  }
  if (!(await exists(legifrance))) {
    throw new Error(`Ressources PieceMaker incomplètes — ${legifrance} est absent.`);
  }
  if (!(await exists(docxCli))) {
    throw new Error(`Ressources PieceMaker incomplètes — ${docxCli} est absent.`);
  }
  if (!(await exists(pieceMakerSkill))) {
    throw new Error(`Ressources PieceMaker incomplètes — ${pieceMakerSkill} est absent.`);
  }
  if (!(await exists(path.join(redactionFrom, 'SKILL.md')))) {
    throw new Error(`Ressources PieceMaker incomplètes — ${path.join(redactionFrom, 'SKILL.md')} est absent.`);
  }
  await fs.mkdir(path.dirname(redactionTo), { recursive: true });
  await fs.cp(redactionFrom, redactionTo, { recursive: true });
  if (!(await exists(path.join(redactionTo, 'SKILL.md')))) {
    throw new Error(`Ressources PieceMaker incomplètes — ${path.join(redactionTo, 'SKILL.md')} est absent.`);
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
  if (process.platform === 'win32') configureWindowsUpdates(manifest, releaseRepo, Boolean(process.env.CSC_LINK), PRODUCT_ICONS.win);
  for (const pattern of ['server/**', `${OVERLAY_DIR}/**`, `${BUNDLE_DIR}/**`]) {
    if (!manifest.build.files.includes(pattern)) manifest.build.files.push(pattern);
  }

  if (process.platform === 'win32') manifest.build.files.push('desktop-bootstrap/**');

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
  await fs.cp(from, to, { recursive: true, filter: isShippedFile });
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
    const installerDir = path.join(os.tmpdir(), 'piecemaker-rustup');
    await fs.mkdir(installerDir, { recursive: true });
    const installer = path.join(installerDir, 'rustup-init.exe');
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

async function downloadReleaseAsset(asset, destination, label) {
  if (process.platform !== 'win32') return false;
  if (process.env.PIECEMAKER_PREBUILT_ASSET_DIR) {
    const input = path.join(process.env.PIECEMAKER_PREBUILT_ASSET_DIR, asset);
    if (await exists(input)) {
      const expected = (await fs.readFile(`${input}.sha256`, 'utf8')).trim().split(/\s+/)[0];
      const actual = crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');
      if (actual !== expected) throw new Error(`Artefact CI invalide : ${asset}`);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(input, destination);
      return true;
    }
  }
  const base = `https://github.com/${releaseRepo}/releases/download/${releaseTag}/${asset}`;
  try {
    const [binary, checksum] = await Promise.all([fetch(base), fetch(`${base}.sha256`)]);
    if (!binary.ok || !checksum.ok) throw new Error(`HTTP ${binary.status}/${checksum.status}`);
    const bytes = Buffer.from(await binary.arrayBuffer());
    const expected = (await checksum.text()).trim().split(/\s+/)[0].toLowerCase();
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) throw new Error('empreinte SHA-256 invalide');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    ui.ok(`${label} précompilé vérifié (${releaseTag}).`);
    return true;
  } catch (error) {
    ui.warn(`${label} précompilé indisponible (${error.message}) — compilation locale.`);
    return false;
  }
}

async function downloadPrebuiltProxy(destination) {
  if (process.platform !== 'win32') return false;
  ui.step("Téléchargement du proxy d'anonymisation précompilé…");
  return downloadReleaseAsset('piecemaker-hudsucker-win32-x64.exe', destination, "Proxy d'anonymisation");
}

async function downloadPrebuiltSqlite(stageDir) {
  const destination = path.join(stageDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  return downloadReleaseAsset('better-sqlite3-electron-win32-x64.node', destination, 'better-sqlite3 pour Electron');
}

export function windowsTar() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

export async function downloadPrebuiltApp(workDir) {
  if (process.platform !== 'win32') return null;
  ui.step("Téléchargement de l'application précompilée…");
  const archive = path.join(workDir, 'piecemaker-desktop-win32-x64.tar.gz');
  if (!(await downloadReleaseAsset('piecemaker-desktop-win32-x64.tar.gz', archive, "Paquet de l'application"))) return null;
  const destination = path.join(workDir, 'prebuilt', releaseTag);
  try {
    await fs.rm(destination, { recursive: true, force: true });
    await fs.mkdir(destination, { recursive: true });
    await run(windowsTar(), ['-xzf', archive, '-C', destination]);
    if (!(await exists(path.join(destination, `${PRODUCT_NAME}.exe`)))) throw new Error(`${PRODUCT_NAME}.exe absent de l'archive`);
    await verifyBuiltApp(destination);
    ui.ok(`Application précompilée prête : ${destination}`);
    return destination;
  } catch (error) {
    ui.warn(`Application précompilée inutilisable (${error.message}) — construction locale.`);
    return null;
  } finally {
    await fs.rm(archive, { force: true });
  }
}

async function buildAnonymizerProxy(sourceDir) {
  const binaryName = process.platform === 'win32' ? 'piecemaker-hudsucker.exe' : 'piecemaker-hudsucker';
  const destinationDir = path.join(sourceDir, 'server', 'piecemaker', 'anonymizer', 'bin');
  await fs.mkdir(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, binaryName);
  if (await downloadPrebuiltProxy(destination)) return destination;

  const env = await ensureCargo();
  const project = path.join(sourceDir, 'server', 'piecemaker', 'anonymizer', 'hudsucker-proxy');
  ui.step("Compilation du proxy d'anonymisation…");
  await run('cargo', ['build', '--release', '--manifest-path', path.join(project, 'Cargo.toml')], {
    cwd: sourceDir,
    env,
  });
  const built = path.join(project, 'target', 'release', binaryName);
  await fs.copyFile(built, destination);
  if (process.platform !== 'win32') await fs.chmod(destination, 0o755);
  ui.detail('Proxy d\'anonymisation embarqué.');
  return destination;
}

async function smokeTestAnonymizerProxy(sourceDir, binary) {
  ui.step("Test du proxy d'anonymisation en bac à sable…");
  const smokeModule = path.join(sourceDir, 'server', 'piecemaker', 'anonymizer', 'hudsucker-smoke.cjs');
  const { runHudsuckerSmokeTest } = createRequire(smokeModule)(smokeModule);
  const result = await runHudsuckerSmokeTest({
    binary,
    caCert: caCertPath,
    caKey: caKeyPath,
    report: ({ name, ok, detail }) => (ok ? ui.detail(`${name}${detail ? ` — ${detail}` : ''}`) : ui.fail(`${name} — ${detail}`)),
  });
  if (!result.ok) {
    throw new Error("Le proxy d'anonymisation échoue en bac à sable : installation interrompue, l'application en place est conservée.");
  }
  ui.ok(`Proxy d'anonymisation validé${result.sandboxed ? ' (sandbox-exec : réseau local seul, écriture confinée)' : ' (dossier et ports isolés)'}.`);
}

export async function buildDesktopApp(sourceDir, { windowsInstaller = false } = {}) {
  ui.step('Installation des dépendances du projet (plusieurs minutes)…');
  await npm(['install', '--no-audit', '--no-fund'], { cwd: sourceDir });
  await npm(['rebuild', 'better-sqlite3', '--no-audit', '--no-fund'], { cwd: sourceDir });
  await smokeTestAnonymizerProxy(sourceDir, await buildAnonymizerProxy(sourceDir));

  ui.step('Compilation du client et du serveur…');
  await npm(['run', 'build'], { cwd: sourceDir });

  ui.step("Préparation de l'application de bureau…");
  await npm(['run', 'desktop:stage'], { cwd: sourceDir });
  const stageDir = path.join(sourceDir, '.desktop-build', 'desktop-app');
  await embedLocalServer(sourceDir, stageDir);
  await embedDesktopOverlay(stageDir);
  if (process.platform === 'win32') {
    await fs.cp(path.join(bootstrapRoot, 'lib'), path.join(stageDir, 'desktop-bootstrap', 'lib'), { recursive: true, filter: isShippedFile });
    await fs.cp(path.join(bootstrapRoot, 'composants'), path.join(stageDir, 'desktop-bootstrap', 'composants'), { recursive: true, filter: isShippedFile });
    await fs.cp(path.join(bootstrapRoot, 'certs'), path.join(stageDir, 'desktop-bootstrap', 'certs'), { recursive: true, filter: isShippedFile });
    await fs.cp(path.join(bootstrapRoot, 'installer-ui'), path.join(stageDir, 'desktop-bootstrap', 'installer-ui'), { recursive: true, filter: isShippedFile });
    await embedMinGit(stageDir);
    if (windowsInstaller) {
      await fs.copyFile(path.join(process.env.PIECEMAKER_PREBUILT_ASSET_DIR, 'python-runtime.json'), path.join(stageDir, 'python-runtime.json'));
      const manifestPath = path.join(stageDir, 'package.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.build.files.push('python-runtime.json');
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  await embedBundledPlugins(sourceDir, stageDir);
  await patchStagedManifest(stageDir);
  if (process.platform === 'win32') {
    await npm(['install', '--save-exact', '--omit=dev', '--no-audit', '--no-fund', 'electron-updater@6.8.9'], { cwd: stageDir });
    const removed = await pruneDesktopDependencies(sourceDir, stageDir, npm);
    ui.detail(`Dépendances de construction retirées du paquet : ${removed.join(', ')}`);
  }
  await repairStagedTree(stageDir);
  const prebuiltSqlite = await downloadPrebuiltSqlite(stageDir);
  if (process.platform === 'win32') {
    await packageRuntimeComponents(stageDir, {
      repository: releaseRepo,
      releaseTag,
      outputDir: path.join(sourceDir, 'release', 'desktop'),
    });
    const manifestPath = path.join(stageDir, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    for (const name of Object.keys(manifest.dependencies)) {
      if (name.startsWith('@openai/') || name.startsWith('@anthropic-ai/')) delete manifest.dependencies[name];
    }
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await npm(['prune', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stageDir });
    await repairStagedTree(stageDir);
    await configureCompactPackage(stageDir);
  }

  ui.step("Construction de l'application Electron…");
  const builderArgs = ['electron-builder', '--projectDir', '.desktop-build/desktop-app', ...(windowsInstaller ? ['--win', 'nsis', '--x64', '--publish', 'never'] : ['--dir'])];
  if (prebuiltSqlite && process.platform !== 'win32') builderArgs.push('-c.npmRebuild=false');
  const signingEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  if (process.env.CSC_LINK && !process.env.WIN_CSC_LINK) signingEnv.WIN_CSC_LINK = process.env.CSC_LINK;
  if (process.env.CSC_KEY_PASSWORD && !process.env.WIN_CSC_KEY_PASSWORD) signingEnv.WIN_CSC_KEY_PASSWORD = process.env.CSC_KEY_PASSWORD;
  await npx(builderArgs, {
    cwd: sourceDir,
    env: signingEnv,
  });

  const built = await findBuiltApp(sourceDir);
  await verifyBuiltApp(built);
  ui.ok(`Application construite : ${built}`);
  return built;
}
