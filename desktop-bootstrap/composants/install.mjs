import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { requirementsForPlatform, sharedPythonMarker, sharedPythonProbe, sharedPythonFingerprint, sharedPythonReady, sharedPythonEntrypoints } from './shared-python.mjs';

const PYTHON_RELEASE_API = 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest';
const BUNDLED_PYTHON_MINOR = 12;
const MIN_PYTHON_MINOR = 10;
const MAX_PYTHON_MINOR = 13;
const MAX_WINDOWS_PYTHON_MINOR = 12;
const PROBE_TIMEOUT_MS = 15_000;
const REQUIRED_PACKAGES = ['markitdown', 'pypdf'];
const DEFERRED_REQUIREMENT = /^\s*(gliner2|huggingface[-_]hub)\b/i;

const log = {
  step(message) {
    console.log(`\n\u001b[1;36m==\u001b[0m ${message}`);
  },
  ok(message) {
    console.log(`\u001b[1;32mOK\u001b[0m ${message}`);
  },
};

export function componentLayout(env = process.env, homeDir = os.homedir()) {
  const dataHome = env.PIECEMAKER_HOME || path.join(homeDir, '.piecemaker');
  const root = env.PIECEMAKER_COMPONENTS_HOME || dataHome;
  return {
    dataHome,
    root,
    pythonDir: path.join(root, 'python'),
    venvDir: path.join(root, 'venv'),
    configFile: path.join(dataHome, 'config.json'),
  };
}

export function scriptsDirectory(sourceDir) {
  return path.join(sourceDir, 'server', 'piecemaker', 'vendor', 'websocket-server', 'scripts');
}

export function pythonTriple(platform, arch) {
  const machine = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : '';
  if (!machine) return '';
  if (platform === 'darwin') return `${machine}-apple-darwin`;
  if (platform === 'win32') return `${machine}-pc-windows-msvc`;
  return '';
}

export function parsePythonVersion(text) {
  const match = String(text || '').match(/Python (\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

export function pythonIsCompatible(version, platform) {
  if (!version) return false;
  const [major, minor] = version;
  const maxMinor = platform === 'win32' ? MAX_WINDOWS_PYTHON_MINOR : MAX_PYTHON_MINOR;
  return major === 3 && minor >= MIN_PYTHON_MINOR && minor <= maxMinor;
}

export function systemPythonCandidates(env, platform) {
  const candidates = [];
  if (env.PYTHON_PATH) candidates.push(env.PYTHON_PATH);
  candidates.push(...(platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']));
  return [...new Set(candidates)];
}

export function bundledPythonPath(pythonDir, platform) {
  return platform === 'win32'
    ? path.join(pythonDir, 'python.exe')
    : path.join(pythonDir, 'bin', 'python3');
}

export function venvPythonPath(venvDir, platform) {
  return platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

export function selectPythonAsset(assets, platform, arch) {
  const triple = pythonTriple(platform, arch);
  if (!triple) return null;
  const pattern = new RegExp(
    `^cpython-3\\.${BUNDLED_PYTHON_MINOR}\\.(\\d+)\\+\\d+-${triple}-install_only_stripped\\.tar\\.gz$`,
  );
  const matches = [];
  for (const asset of assets || []) {
    const match = asset?.name?.match(pattern);
    if (!match || !asset.browser_download_url || !asset.digest) continue;
    matches.push({ asset, patch: Number(match[1]) });
  }
  matches.sort((left, right) => right.patch - left.patch);
  return matches[0]?.asset || null;
}

export function parseStatus(stdout) {
  const start = String(stdout || '').indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

export function dependenciesReady(status) {
  const dependencies = status?.dependencies;
  if (!dependencies) return false;
  return REQUIRED_PACKAGES.every((name) => dependencies[name]);
}

export function installerRequirements(text) {
  return String(text || '').split(/\r?\n/).filter((line) => !DEFERRED_REQUIREMENT.test(line)).join('\n');
}

export function mergeRuntimeConfig(current, paths) {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  return { ...base, ...paths };
}

export function createHost() {
  return {
    async exists(target) {
      try {
        await fs.access(target);
        return true;
      } catch {
        return false;
      }
    },
    async readFile(target) {
      return fs.readFile(target, 'utf8');
    },
    async writeFile(target, content) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    },
    async mkdir(target) {
      await fs.mkdir(target, { recursive: true });
    },
    async rm(target) {
      await fs.rm(target, { recursive: true, force: true });
    },
    async list(target) {
      try {
        return await fs.readdir(target);
      } catch {
        return [];
      }
    },
    run: spawnCommand,
    fetch: globalThis.fetch,
  };
}

function spawnCommand(command, args, { cwd = os.homedir(), env, capture = false, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', ...env },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    const stdout = [];
    const stderr = [];
    if (capture) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
    }
    child.on('error', (error) => {
      if (capture) finish({ code: 1, stdout: '', stderr: error.message });
      else if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (code) => {
      finish({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

async function required(host, command, args, options) {
  let result;
  try {
    result = await host.run(command, args, options);
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} : ${error.message}`);
  }
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} a échoué (code ${result.code})${detail ? ` : ${detail.slice(0, 400)}` : ''}.`);
  }
  return result;
}

async function readPythonVersion(host, command) {
  try {
    const result = await host.run(command, ['--version'], { capture: true, timeoutMs: PROBE_TIMEOUT_MS });
    if (result.code !== 0) return null;
    return parsePythonVersion(`${result.stdout}\n${result.stderr}`);
  } catch {
    return null;
  }
}

async function readWarmupStatus(host, python, warmup, cwd) {
  try {
    const result = await host.run(python, [warmup, '--status'], { cwd, capture: true });
    return parseStatus(result.stdout);
  } catch {
    return null;
  }
}

async function readConfig(host, configFile) {
  if (!(await host.exists(configFile))) return {};
  try {
    return JSON.parse(await host.readFile(configFile));
  } catch {
    throw new Error(`Configuration illisible : ${configFile}`);
  }
}

async function downloadVerified(host, url, destination, digest) {
  const response = await host.fetch(url, {
    headers: { 'User-Agent': 'PieceMaker' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Téléchargement impossible (${response.status}) : ${url}`);
  }
  const hash = crypto.createHash('sha256');
  const partial = `${destination}.partial`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk);
      yield chunk;
    }
  }, createWriteStream(partial));
  const expected = String(digest).replace(/^sha256:/, '').toLowerCase();
  const actual = hash.digest('hex');
  if (actual !== expected) {
    await fs.rm(partial, { force: true });
    throw new Error('Le contrôle d\'intégrité de Python a échoué.');
  }
  await fs.rename(partial, destination);
}

async function installBundledPython(host, layout, platform, arch, output) {
  const triple = pythonTriple(platform, arch);
  if (!triple) throw new Error(`Architecture non prise en charge : ${platform}/${arch}.`);
  output.step(`Téléchargement de Python 3.${BUNDLED_PYTHON_MINOR} (${triple})…`);
  const response = await host.fetch(PYTHON_RELEASE_API, {
    headers: {
      'User-Agent': 'PieceMaker',
      Accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`Impossible de trouver une distribution Python (${response.status}).`);
  const asset = selectPythonAsset((await response.json()).assets, platform, arch);
  if (!asset) throw new Error(`Aucune distribution Python 3.${BUNDLED_PYTHON_MINOR} pour ${triple}.`);
  const archive = path.join(layout.root, 'python.tar.gz');
  await downloadVerified(host, asset.browser_download_url, archive, asset.digest);
  await host.rm(layout.pythonDir);
  await host.mkdir(layout.root);
  await required(host, 'tar', ['-xzf', archive, '-C', layout.root]);
  await host.rm(archive);
}

async function resolveBasePython(host, layout, env, platform, arch, output) {
  for (const candidate of systemPythonCandidates(env, platform)) {
    if (pythonIsCompatible(await readPythonVersion(host, candidate), platform)) return candidate;
  }
  const bundled = bundledPythonPath(layout.pythonDir, platform);
  if (pythonIsCompatible(await readPythonVersion(host, bundled), platform)) return bundled;
  await installBundledPython(host, layout, platform, arch, output);
  if (!pythonIsCompatible(await readPythonVersion(host, bundled), platform)) {
    throw new Error(`L'interpréteur Python installé n'est pas utilisable (${bundled}).`);
  }
  return bundled;
}

export function assertSafePythonEntries(entries, details) {
  if (details.split(/\r?\n/).some(line => /^[lh]/.test(line))) throw new Error('Archive Python contenant un lien.');
  for (const raw of entries.split(/\r?\n/).filter(Boolean)) {
    const entry = raw.replace(/\/$/, '');
    if (entry.includes('\\') || entry.split('/').some(part => !part || part === '.' || part === '..') || (entry !== 'python' && !entry.startsWith('python/'))) {
      throw new Error(`Entree Python invalide : ${raw}`);
    }
  }
}

async function installPrebuiltPython({ layout, host, env, scriptsDir, output, platform, arch, metadata }) {
  if (!/^[a-f0-9]{64}$/.test(metadata.sha256) || metadata.assetName !== `piecemaker-python-${platform}-${arch}.tar.gz` || !/^[\w.-]+\/[\w.-]+$/.test(metadata.repository) || !/^[\w.-]+$/.test(metadata.releaseTag) || (metadata.requirementsSha256 !== undefined && !/^[a-f0-9]{64}$/.test(metadata.requirementsSha256))) {
    throw new Error('Metadonnees Python invalides.');
  }
  const root = path.join(layout.root, 'runtime-python', metadata.sha256.slice(0, 24));
  const python = bundledPythonPath(path.join(root, 'python'), platform);
  const warmup = path.join(scriptsDir, 'warmup.py');
  if (!(await host.exists(python)) || (metadata.requirementsSha256 && !await sharedPythonReady(host, python, metadata.requirementsSha256)) || !dependenciesReady(await readWarmupStatus(host, python, warmup, scriptsDir))) {
    await host.mkdir(path.dirname(root));
    const staging = `${root}.${crypto.randomBytes(6).toString('hex')}`;
    const downloaded = `${staging}.tar.gz`;
    let archive = downloaded;
    try {
      output.step('Telechargement des composants Python precompiles...');
      const local = env.PIECEMAKER_PREBUILT_ASSET_DIR && path.join(env.PIECEMAKER_PREBUILT_ASSET_DIR, metadata.assetName);
      if (local && await host.exists(local)) {
        const hash = crypto.createHash('sha256');
        for await (const chunk of createReadStream(local)) hash.update(chunk);
        if (hash.digest('hex') !== metadata.sha256) throw new Error('Archive Python locale invalide.');
        archive = local;
      } else {
        await downloadVerified(host, `https://github.com/${metadata.repository}/releases/download/${metadata.releaseTag}/${metadata.assetName}`, downloaded, metadata.sha256);
      }
      const tar = platform === 'win32' ? path.join(env.SystemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      const entries = await required(host, tar, ['-tzf', archive], { capture: true });
      const details = await required(host, tar, ['-tvzf', archive], { capture: true });
      assertSafePythonEntries(entries.stdout, details.stdout);
      await host.mkdir(staging);
      await required(host, tar, ['-xzf', archive, '-C', staging]);
      const stagedPython = bundledPythonPath(path.join(staging, 'python'), platform);
      if (metadata.requirementsSha256) {
        if (!await sharedPythonReady(host, stagedPython, metadata.requirementsSha256)) throw new Error('Environnement Python commun incompatible avec cette release.');
        await required(host, stagedPython, ['-c', sharedPythonProbe], { capture: true, timeoutMs: 300_000 });
      }
      if (!dependenciesReady(await readWarmupStatus(host, stagedPython, warmup, scriptsDir))) {
        const diagnostic = await host.run(stagedPython, [warmup, '--status'], { cwd: scriptsDir, capture: true });
        throw new Error(`Paquet Python precompile non operationnel : ${diagnostic.stderr}\n${diagnostic.stdout}`);
      }
      await host.rm(root);
      await fs.rename(staging, root);
    } finally {
      if (archive === downloaded) await host.rm(downloaded);
      await host.rm(staging);
    }
  }
  if (metadata.requirementsSha256) await required(host, python, ['-c', sharedPythonEntrypoints], { capture: true, timeoutMs: 120_000 });
  return {
    pythonPath: python,
    venvPath: path.join(root, 'python'),
    ...(metadata.requirementsSha256 ? { pythonRuntime: { kind: 'shared', requirementsSha256: metadata.requirementsSha256, sha256: metadata.sha256 } } : {}),
  };
}

export function supersededPythonDirectories(layout, runtimeNames, keptPythons) {
  const comparable = target => (process.platform === 'win32' ? path.resolve(target).toLowerCase() : path.resolve(target));
  const kept = keptPythons.filter(Boolean).map(comparable);
  const inUse = directory => kept.some(python => python === comparable(directory) || python.startsWith(`${comparable(directory)}${path.sep}`));
  const runtimes = runtimeNames.map(name => path.join(layout.root, 'runtime-python', name));
  const legacy = inUse(layout.venvDir) || inUse(layout.pythonDir) ? [] : [layout.venvDir, layout.pythonDir];
  return [...runtimes, ...legacy].filter(directory => !inUse(directory));
}

async function removeSupersededPythons(host, layout, keptPythons) {
  const names = await host.list(path.join(layout.root, 'runtime-python'));
  for (const directory of supersededPythonDirectories(layout, names, keptPythons)) {
    try {
      await host.rm(directory);
    } catch {}
  }
}

export async function buildPortablePython({ sourceDir, root, archive, platform = process.platform, arch = process.arch, host = createHost(), output = log }) {
  const requirements = requirementsForPlatform(platform, arch);
  const layout = componentLayout({ PIECEMAKER_COMPONENTS_HOME: root }, root);
  await host.mkdir(root);
  await installBundledPython(host, layout, platform, arch, output);
  const python = bundledPythonPath(layout.pythonDir, platform);
  const scripts = scriptsDirectory(sourceDir);
  const wheels = path.join(root, 'wheels');
  await host.mkdir(wheels);
  await required(host, python, ['-m', 'pip', 'wheel', '--no-deps', '--use-pep517', '--wheel-dir', wheels, 'jieba==0.42.1']);
  await required(host, python, ['-m', 'pip', 'install', ...(platform === 'darwin' ? ['--no-compile'] : []), '--only-binary=:all:', '--find-links', wheels, '-r', requirements]);
  await required(host, python, ['-m', 'pip', 'check']);
  await required(host, python, ['-c', sharedPythonProbe], { capture: true, timeoutMs: 300_000 });
  await host.writeFile(path.join(path.dirname(python), sharedPythonMarker), `${JSON.stringify({ format: 1, requirementsSha256: await sharedPythonFingerprint(platform, arch) })}\n`);
  if (!dependenciesReady(await readWarmupStatus(host, python, path.join(scripts, 'warmup.py'), scripts))) throw new Error('Python compile non operationnel.');
  if (platform === 'darwin') {
    await required(host, python, ['-c', 'import sys,tarfile; archive=tarfile.open(sys.argv[1],"w:gz",dereference=True); archive.add(sys.argv[2],arcname="python"); archive.close()', archive, layout.pythonDir]);
  } else {
    await required(host, 'tar', ['-czf', archive, '-C', root, 'python']);
  }
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  return hash.digest('hex');
}

export async function installRuntimeComponents({
  sourceDir,
  env = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
  arch = process.arch,
  host = createHost(),
  output = log,
  requirePrebuilt = false,
  runtimeMetadata,
} = {}) {
  if (!sourceDir) throw new Error('PIECEMAKER_SRC_DIR est absent — lancez install.sh ou install.ps1.');
  const layout = componentLayout(env, homeDir);
  const scriptsDir = scriptsDirectory(sourceDir);
  const requirements = path.join(scriptsDir, 'requirements.txt');
  const warmup = path.join(scriptsDir, 'warmup.py');
  if (!(await host.exists(requirements)) || !(await host.exists(warmup))) {
    throw new Error(`Scripts Python introuvables dans ${scriptsDir}.`);
  }

  output.step('Composants Python — MarkItDown');
  const configured = await readConfig(host, layout.configFile);
  let python = '';
  if (requirePrebuilt) {
    const metadata = runtimeMetadata || JSON.parse(await host.readFile(path.join(sourceDir, 'python-runtime.json')));
    if (!metadata.requirementsSha256 && configured.pythonPath && await host.exists(configured.pythonPath) && dependenciesReady(await readWarmupStatus(host, configured.pythonPath, warmup, scriptsDir))) {
      output.ok('Composants Python existants reutilises.');
      python = configured.pythonPath;
    } else {
      requirementsForPlatform(platform, arch);
      const paths = await installPrebuiltPython({ layout, host, env, scriptsDir, output, platform, arch, metadata });
      await host.writeFile(layout.configFile, `${JSON.stringify(mergeRuntimeConfig(configured, paths), null, 2)}\n`);
      await removeSupersededPythons(host, layout, [paths.pythonPath, configured.pythonPath]);
      output.ok('Composants Python precompiles installes.');
      python = paths.pythonPath;
    }
  } else {
    python = venvPythonPath(layout.venvDir, platform);
    const installedVersion = (await host.exists(python)) ? await readPythonVersion(host, python) : null;
    if (!pythonIsCompatible(installedVersion, platform)) {
      const basePython = await resolveBasePython(host, layout, env, platform, arch, output);
      output.step(`Création de l'environnement Python (${layout.venvDir})…`);
      await host.rm(layout.venvDir);
      await host.mkdir(path.dirname(layout.venvDir));
      await required(host, basePython, ['-m', 'venv', layout.venvDir]);
      python = venvPythonPath(layout.venvDir, platform);
    }

    if (dependenciesReady(await readWarmupStatus(host, python, warmup, scriptsDir))) {
      output.ok('MarkItDown et les bibliothèques associées sont déjà installés.');
    } else {
      output.step('Installation des bibliothèques Python (MarkItDown)…');
      const installationRequirements = path.join(layout.root, 'requirements-installation.txt');
      const declared = await host.readFile(requirements);
      await host.writeFile(installationRequirements, installerRequirements(declared));
      await required(host, python, ['-m', 'pip', 'install', '-U', 'pip']);
      await required(host, python, ['-m', 'pip', 'install', '--upgrade', '-r', installationRequirements]);
      if (!dependenciesReady(await readWarmupStatus(host, python, warmup, scriptsDir))) {
        throw new Error('Les composants Python ne sont pas opérationnels après installation.');
      }
    }

    const next = mergeRuntimeConfig(await readConfig(host, layout.configFile), {
      pythonPath: python,
      venvPath: layout.venvDir,
    });
    await host.writeFile(layout.configFile, `${JSON.stringify(next, null, 2)}\n`);
    output.ok(`Interpréteur enregistré : ${python}`);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  installRuntimeComponents({ sourceDir: process.env.PIECEMAKER_SRC_DIR }).catch((error) => {
    console.error(`\u001b[1;31m!!\u001b[0m ${error.message}`);
    process.exitCode = 1;
  });
}
