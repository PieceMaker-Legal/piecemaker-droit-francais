import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { componentLayout } from './install.mjs';

export const catalaRecipe = JSON.parse(readFileSync(new URL('./catala-pack.json', import.meta.url), 'utf8'));
export const catalaMarker = '.piecemaker-catala.json';
const OWNER = 'piecemaker-catala';
const MAC_TOOL_DIRECTORIES = ['/opt/homebrew/bin', '/usr/local/bin'];
const BINARIES = ['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap'];

export function catalaPlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32' && arch === 'x64') return 'windows';
  return null;
}

export function catalaPackId(recipe, platformKey) {
  const content = JSON.stringify({ format: recipe.format, catala: recipe.catala, platform: platformKey, recipe: recipe[platformKey] });
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 24);
}

export function catalaLayout(env = process.env, homeDir = os.homedir()) {
  const base = path.join(componentLayout(env, homeDir).root, 'catala');
  return {
    base,
    packFile: path.join(base, 'pack.json'),
    statusFile: path.join(base, 'status.json'),
    logFile: path.join(base, 'install.log'),
    lockFile: path.join(base, 'install.lock'),
  };
}

export function macosSteps(recipe, directory, jobs) {
  const { opamRepository, compiler, pins, packages } = recipe.macos;
  const opamRoot = path.join(directory, 'opam');
  return [
    { name: 'opam-init', done: path.join(opamRoot, 'config'), args: ['init', '--bare', '--no-setup', '--yes', 'default', opamRepository] },
    { name: 'switch', done: path.join(opamRoot, 'catala', '.opam-switch', 'switch-state'), args: ['switch', 'create', 'catala', compiler, '--no-switch', '--yes'] },
    ...Object.entries(pins).map(([name, url]) => ({ name: `pin-${name}`, args: ['pin', 'add', '--no-action', '--yes', name, url] })),
    { name: 'install', args: ['install', '--yes', `--jobs=${jobs}`, ...packages] },
  ];
}

export function macosPack(directory, toolDirectory) {
  const prefix = path.join(directory, 'opam', 'catala');
  return {
    prefix,
    bin: Object.fromEntries(BINARIES.map((name) => [name, path.join(prefix, 'bin', name)])),
    path: [path.join(prefix, 'bin'), toolDirectory].filter(Boolean),
    env: {
      OPAMROOT: path.join(directory, 'opam'),
      OPAMSWITCH: 'catala',
      OPAM_SWITCH_PREFIX: prefix,
      CAML_LD_LIBRARY_PATH: [path.join(prefix, 'lib', 'stublibs'), path.join(prefix, 'lib', 'ocaml', 'stublibs')].join(':'),
    },
    runtimePython: path.join(prefix, 'lib', 'catala', 'runtime', 'python', 'src'),
    proof: true,
  };
}

export function windowsPack(home) {
  return {
    prefix: home,
    bin: Object.fromEntries(BINARIES.map((name) => [name, path.win32.join(home, 'bin', `${name}.cmd`)])),
    path: [path.win32.join(home, 'bin')],
    env: {},
    runtimePython: path.win32.join(home, 'toolchain', 'lib', 'catala', 'runtime', 'python', 'src'),
    proof: false,
  };
}

export function createCatalaHost() {
  return {
    async exists(target) {
      return fs.access(target).then(() => true, () => false);
    },
    readFile: (target) => fs.readFile(target, 'utf8'),
    async writeFile(target, content) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.tmp-${process.pid}`;
      await fs.writeFile(temporary, content, 'utf8');
      await fs.rename(temporary, target);
    },
    mkdir: (target) => fs.mkdir(target, { recursive: true }),
    rm: (target) => fs.rm(target, { recursive: true, force: true }),
    list: (target) => fs.readdir(target).catch(() => []),
    async lock(target) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.writeFile(target, String(process.pid), { flag: 'wx' });
        return true;
      } catch {
        const pid = Number(await fs.readFile(target, 'utf8').catch(() => ''));
        if (pid && pid !== process.pid && processAlive(pid)) return false;
        await fs.writeFile(target, String(process.pid));
        return true;
      }
    },
    unlock: (target) => fs.rm(target, { force: true }),
    run: runLogged,
    download,
    fetch: globalThis.fetch,
    cpus: () => os.availableParallelism?.() ?? os.cpus().length,
  };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function runLogged(command, args, { env, log, cwd = os.homedir() } = {}) {
  return new Promise((resolve) => {
    const output = log ? createWriteStream(log, { flags: 'a' }) : null;
    output?.write(`\n$ ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const captured = [];
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        captured.push(chunk);
        output?.write(chunk);
      });
    }
    const finish = (code, message = '') => {
      output?.end(message ? `${message}\n` : '');
      resolve({ code, output: Buffer.concat(captured).toString('utf8').slice(-4000) + message });
    };
    child.on('error', (error) => finish(1, error.message));
    child.on('close', (code) => finish(code ?? 1));
  });
}

async function download(fetchImpl, url, destination, expected) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'PieceMaker' }, redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Téléchargement impossible (${response.status}) : ${url}`);
  const hash = crypto.createHash('sha256');
  const partial = `${destination}.partial`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk);
      yield chunk;
    }
  }, createWriteStream(partial));
  if (hash.digest('hex') !== expected) {
    await fs.rm(partial, { force: true });
    throw new Error(`Empreinte inattendue pour ${url}.`);
  }
  await fs.rename(partial, destination);
}

async function required(host, command, args, options, step) {
  const result = await host.run(command, args, options);
  if (result.code !== 0) throw new Error(`${step} a échoué (code ${result.code}) : ${result.output.trim().slice(-600)}`);
  return result;
}

async function findTool(host, name, directories) {
  for (const directory of directories) {
    const candidate = path.join(directory, name);
    if (await host.exists(candidate)) return candidate;
  }
  return null;
}

async function installMacos({ host, recipe, directory, env, log, setStep }) {
  const brew = await findTool(host, 'brew', MAC_TOOL_DIRECTORIES);
  if (!brew) return { skipped: 'Homebrew est requis pour compiler Catala sur macOS (https://brew.sh).' };
  const toolDirectory = path.dirname(brew);
  const searchPath = [toolDirectory, path.join(os.homedir(), '.cargo', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  const runEnv = { ...env, PATH: searchPath, HOMEBREW_NO_AUTO_UPDATE: '1', OPAMROOT: path.join(directory, 'opam'), OPAMSWITCH: 'catala', OPAMYES: '1', OPAMCONFIRMLEVEL: 'unsafe-yes', OPAMCOLOR: 'never' };
  let opam = await findTool(host, 'opam', [toolDirectory]);
  if (!opam) {
    await setStep('opam');
    await required(host, brew, ['install', 'opam'], { env: runEnv, log }, 'brew install opam');
    opam = path.join(toolDirectory, 'opam');
  }
  for (const step of macosSteps(recipe, directory, Math.max(1, Math.floor(host.cpus() / 2)))) {
    if (step.done && await host.exists(step.done)) continue;
    await setStep(step.name);
    await required(host, opam, step.args, { env: runEnv, log }, `opam ${step.name}`);
  }
  return macosPack(directory, toolDirectory);
}

async function findCatalaHome(host, directory, depth = 4) {
  if (await host.exists(path.win32.join(directory, 'bin', 'catala.cmd'))) return directory;
  if (depth === 0) return null;
  for (const entry of await host.list(directory)) {
    const found = await findCatalaHome(host, path.win32.join(directory, entry), depth - 1);
    if (found) return found;
  }
  return null;
}

async function installWindows({ host, recipe, directory, env, log, setStep }) {
  const { url, sha256 } = recipe.windows.msi;
  const target = path.win32.join(directory, 'msi');
  let home = await findCatalaHome(host, target);
  if (!home) {
    const msi = path.win32.join(directory, path.win32.basename(new URL(url).pathname));
    await setStep('download');
    if (!(await host.exists(msi))) await host.download(host.fetch, url, msi, sha256);
    await setStep('extract');
    const system = env.SystemRoot || 'C:\\Windows';
    await required(host, path.win32.join(system, 'System32', 'msiexec.exe'), ['/a', msi, '/qn', `TARGETDIR=${target}`], { env, log }, 'msiexec /a');
    home = await findCatalaHome(host, target);
    if (!home) throw new Error('Catala introuvable après extraction du MSI.');
    await setStep('grammar');
    await required(host, path.win32.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.win32.join(home, 'toolchain', 'libexec', 'grammar-config.ps1'), '-InstallDir', home], { env, log }, 'grammar-config.ps1');
    await host.rm(msi);
  }
  return windowsPack(home);
}

export function catalaCommand(pack, name, args, platform = process.platform) {
  const binary = pack.bin[name];
  if (platform === 'win32') return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', binary, ...args] };
  return { command: binary, args };
}

async function probe(host, pack, platform, env, log) {
  for (const name of Object.keys(pack.bin)) {
    if (!(await host.exists(pack.bin[name]))) throw new Error(`${name} absent du pack Catala.`);
  }
  if (!(await host.exists(path.join(pack.runtimePython, 'catala', 'catala_runtime.py')))) throw new Error('Runtime Python Catala absent du pack.');
  const runEnv = { ...env, ...pack.env, PATH: [...pack.path, env.PATH || ''].join(path.delimiter) };
  const version = catalaCommand(pack, 'catala', ['--version'], platform);
  const result = await required(host, version.command, version.args, { env: runEnv, log }, 'catala --version');
  if (pack.proof) {
    const proof = catalaCommand(pack, 'catala', ['proof', '--help=plain'], platform);
    await required(host, proof.command, proof.args, { env: runEnv, log }, 'catala proof --help');
  }
  return result.output.trim().split('\n').pop();
}

async function readJson(host, file) {
  try {
    return JSON.parse(await host.readFile(file));
  } catch {
    return null;
  }
}

async function ownedPack(host, directory) {
  const marker = await readJson(host, path.join(directory, catalaMarker));
  return marker?.owner === OWNER ? marker : null;
}

async function removeSupersededPacks(host, layout, keptId) {
  for (const entry of await host.list(layout.base)) {
    if (entry === keptId) continue;
    const directory = path.join(layout.base, entry);
    if (await ownedPack(host, directory)) await host.rm(directory);
  }
}

export async function installCatalaPack({ env = process.env, platform = process.platform, arch = process.arch, homeDir = os.homedir(), host = createCatalaHost(), recipe = catalaRecipe, now = () => new Date().toISOString() } = {}) {
  const layout = catalaLayout(env, homeDir);
  const platformKey = catalaPlatform(platform, arch);
  const writeStatus = (status) => host.writeFile(layout.statusFile, `${JSON.stringify({ ...status, updatedAt: now() }, null, 2)}\n`);
  if (!platformKey) {
    await writeStatus({ state: 'indisponible', error: `Plateforme non prise en charge : ${platform}/${arch}.` });
    return { state: 'indisponible' };
  }
  const id = catalaPackId(recipe, platformKey);
  const directory = path.join(layout.base, id);
  const current = await readJson(host, layout.packFile);
  if (current?.id === id && await ownedPack(host, directory) && await host.exists(path.join(directory, 'ready'))) return { state: 'pret', id, pack: current };
  if (!(await host.lock(layout.lockFile))) return { state: 'en-cours', id };
  let step = 'preparation';
  try {
    await host.mkdir(directory);
    await host.writeFile(path.join(directory, catalaMarker), `${JSON.stringify({ format: 1, owner: OWNER, id }, null, 2)}\n`);
    const setStep = async (name) => {
      step = name;
      await writeStatus({ state: 'installation', id, step });
    };
    await setStep(step);
    const install = platformKey === 'macos' ? installMacos : installWindows;
    const pack = await install({ host, recipe, directory, env, log: layout.logFile, setStep });
    if (pack.skipped) {
      await writeStatus({ state: 'indisponible', id, error: pack.skipped });
      return { state: 'indisponible', id, error: pack.skipped };
    }
    await setStep('verification');
    const version = await probe(host, pack, platform, env, layout.logFile);
    const descriptor = { format: 1, id, platform: platformKey, catala: recipe.catala, version, ...pack, installedAt: now() };
    await host.writeFile(path.join(directory, 'ready'), `${now()}\n`);
    await host.writeFile(layout.packFile, `${JSON.stringify(descriptor, null, 2)}\n`);
    await removeSupersededPacks(host, layout, id);
    await writeStatus({ state: 'pret', id });
    return { state: 'pret', id, pack: descriptor };
  } catch (error) {
    await writeStatus({ state: 'echec', id, step, error: error.message });
    return { state: 'echec', id, step, error: error.message };
  } finally {
    await host.unlock(layout.lockFile);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const result = await installCatalaPack();
  console.log(JSON.stringify(result.pack ? { state: result.state, id: result.id } : result));
  process.exitCode = result.state === 'echec' ? 1 : 0;
}
