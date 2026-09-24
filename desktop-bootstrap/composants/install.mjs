import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const PYTHON_RELEASE_API = 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest';
const BUNDLED_PYTHON_MINOR = 12;
const MIN_PYTHON_MINOR = 10;
const MAX_PYTHON_MINOR = 13;
const MAX_WINDOWS_PYTHON_MINOR = 12;
const PROBE_TIMEOUT_MS = 15_000;
const MINERU_SPEC = 'mineru[pipeline,vlm]==2.7.6';
const REQUIRED_PACKAGES = ['gliner2', 'huggingface_hub', 'spacy', 'markitdown', 'pypdf'];

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
    mineruConfig: path.join(homeDir, 'mineru.json'),
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

export function venvScriptPath(venvDir, name, platform) {
  return platform === 'win32'
    ? path.join(venvDir, 'Scripts', `${name}.exe`)
    : path.join(venvDir, 'bin', name);
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

export function glinerReady(status) {
  return Boolean(status?.ready) && status?.gliner2_runtime?.boundary_capable !== false;
}

export function runtimeReady(status) {
  return dependenciesReady(status) && glinerReady(status) && status?.tools?.mineru === true;
}

export function mergeRuntimeConfig(current, paths) {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  return { ...base, pythonPath: paths.pythonPath, venvPath: paths.venvPath };
}

export async function pipelineModelsReady(host, mineruConfig) {
  if (!(await host.exists(mineruConfig))) return false;
  try {
    const config = JSON.parse(await host.readFile(mineruConfig));
    const modelDir = config?.['models-dir']?.pipeline;
    return Boolean(modelDir) && await host.exists(modelDir);
  } catch {
    return false;
  }
}

function createHost() {
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
    run: spawnCommand,
    fetch: globalThis.fetch,
  };
}

function spawnCommand(command, args, { cwd, env, capture = false, timeoutMs = 0 } = {}) {
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
    headers: { 'User-Agent': 'PieceMaker', Accept: 'application/vnd.github+json' },
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

export async function installRuntimeComponents({
  sourceDir,
  env = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
  arch = process.arch,
  host = createHost(),
  output = log,
} = {}) {
  if (!sourceDir) throw new Error('PIECEMAKER_SRC_DIR est absent — lancez install.sh ou install.ps1.');
  const layout = componentLayout(env, homeDir);
  const scriptsDir = scriptsDirectory(sourceDir);
  const requirements = path.join(scriptsDir, 'requirements.txt');
  const warmup = path.join(scriptsDir, 'warmup.py');
  if (!(await host.exists(requirements)) || !(await host.exists(warmup))) {
    throw new Error(`Scripts Python introuvables dans ${scriptsDir}.`);
  }

  output.step('Composants Python — GLiNER, MarkItDown, MinerU');
  let python = venvPythonPath(layout.venvDir, platform);
  const installedVersion = (await host.exists(python)) ? await readPythonVersion(host, python) : null;
  if (!pythonIsCompatible(installedVersion, platform)) {
    const basePython = await resolveBasePython(host, layout, env, platform, arch, output);
    output.step(`Création de l'environnement Python (${layout.venvDir})…`);
    await host.rm(layout.venvDir);
    await host.mkdir(path.dirname(layout.venvDir));
    await required(host, basePython, ['-m', 'venv', layout.venvDir]);
    python = venvPythonPath(layout.venvDir, platform);
  }

  let status = await readWarmupStatus(host, python, warmup, scriptsDir);
  if (dependenciesReady(status)) {
    output.ok('MarkItDown, GLiNER et les bibliothèques associées sont déjà installés.');
  } else {
    output.step('Installation des bibliothèques Python (MarkItDown, GLiNER, Presidio)…');
    await required(host, python, ['-m', 'pip', 'install', '-U', 'pip']);
    await required(host, python, ['-m', 'pip', 'install', '--upgrade', '-r', requirements]);
    status = null;
  }

  if (status?.tools?.mineru === true) {
    output.ok('MinerU est déjà installé.');
  } else {
    output.step('Installation de MinerU…');
    await required(host, python, ['-m', 'pip', 'install', MINERU_SPEC]);
  }

  if (await pipelineModelsReady(host, layout.mineruConfig)) {
    output.ok('Modèles MinerU (pipeline) déjà présents.');
  } else {
    output.step('Téléchargement des modèles MinerU (pipeline)…');
    const downloader = venvScriptPath(layout.venvDir, 'mineru-models-download', platform);
    await required(host, downloader, ['-s', 'huggingface', '-m', 'pipeline'], {
      env: { MINERU_MODEL_SOURCE: 'huggingface' },
    });
  }

  status = await readWarmupStatus(host, python, warmup, scriptsDir);
  if (glinerReady(status)) {
    output.ok('Modèle GLiNER2.5 déjà présent.');
  } else {
    output.step('Téléchargement du modèle GLiNER2.5…');
    await required(host, python, [warmup], { cwd: scriptsDir });
    status = await readWarmupStatus(host, python, warmup, scriptsDir);
  }

  if (!runtimeReady(status)) {
    throw new Error('Les composants Python ne sont pas opérationnels après installation.');
  }

  const next = mergeRuntimeConfig(await readConfig(host, layout.configFile), {
    pythonPath: python,
    venvPath: layout.venvDir,
  });
  await host.writeFile(layout.configFile, `${JSON.stringify(next, null, 2)}\n`);
  output.ok(`Interpréteur enregistré : ${python}`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  installRuntimeComponents({ sourceDir: process.env.PIECEMAKER_SRC_DIR }).catch((error) => {
    console.error(`\u001b[1;31m!!\u001b[0m ${error.message}`);
    process.exitCode = 1;
  });
}
