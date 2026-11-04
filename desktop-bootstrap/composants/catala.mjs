import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { componentLayout } from './install.mjs';

export const catalaRecipe = JSON.parse(readFileSync(new URL('./catala-pack.json', import.meta.url), 'utf8'));
export const catalaMarker = '.piecemaker-catala.json';
export const catalaTools = ['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap'];
const OWNER = 'piecemaker-catala';

export function catalaPlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'macos';
  if (platform === 'win32' && arch === 'x64') return 'windows';
  return null;
}

export function catalaArchiveAsset(platformKey) {
  return `piecemaker-catala-${platformKey}.tar.gz`;
}

export function catalaArchiveSource(recipe, platformKey, env = process.env) {
  const asset = catalaArchiveAsset(platformKey);
  if (env.PIECEMAKER_CATALA_ARCHIVE) {
    const sha256 = String(env.PIECEMAKER_CATALA_ARCHIVE_SHA256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('PIECEMAKER_CATALA_ARCHIVE_SHA256 doit donner le SHA-256 de l’archive locale.');
    return { asset, sha256, file: path.resolve(env.PIECEMAKER_CATALA_ARCHIVE) };
  }
  const pinned = recipe.archive?.[platformKey];
  if (!pinned || !recipe.archive?.tag) return null;
  if (!/^[0-9a-f]{64}$/.test(pinned.sha256 || '')) throw new Error('Empreinte de l’archive Catala invalide.');
  const source = { asset: pinned.asset || asset, sha256: pinned.sha256, size: pinned.size };
  if (env.PIECEMAKER_PREBUILT_ASSET_DIR) return { ...source, file: path.resolve(env.PIECEMAKER_PREBUILT_ASSET_DIR, source.asset) };
  return { ...source, url: `https://github.com/${recipe.archive.repository}/releases/download/${recipe.archive.tag}/${source.asset}` };
}

export function catalaPackId(recipe, platformKey, source) {
  const content = JSON.stringify({ format: recipe.format, catala: recipe.catala, platform: platformKey, archive: source.sha256 });
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

export function unsafeArchiveEntries(names, verbose) {
  const unsafe = names.filter((name) => {
    const clean = name.replace(/\/$/, '');
    const parts = clean.split('/');
    return !clean || clean.includes('\\') || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || parts.some((part) => !part || part === '.' || part === '..');
  });
  const links = verbose.split(/\r?\n/).filter((line) => line && !/^[-d]/.test(line));
  return [...unsafe, ...links];
}

function nickelString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%\{/g, '\\%{')}"`;
}

export function catalaTopiaryConfig(prefix, grammars) {
  const root = prefix.split(path.sep).join('/');
  const languages = grammars.map(({ language, extensions, file }) => [
    `    ${language} = {`,
    `      extensions = [${extensions.map(nickelString).join(', ')}],`,
    `      grammar.source.path = ${nickelString(`${root}/${file}`)},`,
    '    },',
  ].join('\n'));
  return `{\n  languages = {\n${languages.join('\n')}\n  }\n}\n`;
}

export function archivePack(prefix, platformKey, manifest) {
  if (manifest.format !== 1 || manifest.platform !== platformKey || !Array.isArray(manifest.grammars) || !manifest.grammars.length) throw new Error('Manifeste Catala invalide.');
  const files = [...catalaTools, 'ninja'].map((name) => manifest.tools?.[name]);
  files.push(manifest.runtimePython, manifest.topiaryConfig, ...manifest.grammars.map((grammar) => grammar.file));
  if (files.some((file) => typeof file !== 'string' || unsafeArchiveEntries([file], '').length)) throw new Error('Chemin non sûr dans le manifeste Catala.');
  if (manifest.grammars.some(({ language, extensions }) => !/^catala_(en|fr|pl)$/.test(language) || !Array.isArray(extensions) || extensions.some((extension) => typeof extension !== 'string'))) throw new Error('Grammaire Catala invalide.');
  const join = platformKey === 'windows' ? path.win32.join : path.posix.join;
  const local = (relative) => join(prefix, ...relative.split('/'));
  return {
    prefix,
    bin: Object.fromEntries(catalaTools.map((name) => [name, local(manifest.tools[name])])),
    path: [join(prefix, 'bin')],
    env: { NINJA_BIN: local(manifest.tools.ninja), CATALA_STDLIB: join(prefix, 'lib', 'catala', 'runtime') },
    runtimePython: local(manifest.runtimePython),
    proof: true,
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
    rename: (from, to) => fs.rename(from, to),
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
    hashFile,
    fetch: globalThis.fetch,
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

function runLogged(command, args, { env, log, cwd = os.homedir(), quiet = false } = {}) {
  return new Promise((resolve) => {
    const output = log ? createWriteStream(log, { flags: 'a' }) : null;
    output?.write(`\n$ ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const captured = [];
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        captured.push(chunk);
        if (!quiet) output?.write(chunk);
      });
    }
    const finish = (code, message = '') => {
      output?.end(message ? `${message}\n` : '');
      resolve({ code, output: Buffer.concat(captured).toString('utf8') + message });
    };
    child.on('error', (error) => finish(1, error.message));
    child.on('close', (code) => finish(code ?? 1));
  });
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
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

function tarCommand(platformKey, env) {
  return platformKey === 'windows' ? path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
}

async function fetchArchive({ host, source, directory, setStep }) {
  if (source.file) {
    await setStep('verification-archive');
    if (!(await host.exists(source.file))) throw new Error(`Archive Catala introuvable : ${source.file}`);
    if ((await host.hashFile(source.file)) !== source.sha256) throw new Error(`Empreinte inattendue pour ${source.file}.`);
    return { file: source.file, temporary: false };
  }
  const file = path.join(directory, source.asset);
  await setStep('telechargement');
  await host.download(host.fetch, source.url, file, source.sha256);
  return { file, temporary: true };
}

async function extractArchive({ host, platformKey, archive, prefix, env, log, setStep }) {
  const tar = tarCommand(platformKey, env);
  await setStep('controle-archive');
  const names = await required(host, tar, ['-tzf', archive], { env, log, quiet: true }, 'tar -t');
  const verbose = await required(host, tar, ['-tvzf', archive], { env, log, quiet: true }, 'tar -tv');
  const unsafe = unsafeArchiveEntries(names.output.split(/\r?\n/).filter(Boolean), verbose.output);
  if (unsafe.length) throw new Error(`Archive Catala refusée, entrées non sûres : ${unsafe.slice(0, 5).join(', ')}`);
  await setStep('extraction');
  const staging = `${prefix}.extraction`;
  await host.rm(staging);
  await host.mkdir(staging);
  await required(host, tar, ['-xzf', archive, '-C', staging], { env, log }, 'tar -x');
  await host.rm(prefix);
  await host.rename(staging, prefix);
}

async function installArchive({ host, platformKey, source, directory, env, log, setStep, recipe }) {
  const prefix = path.join(directory, 'catala');
  const manifestFile = path.join(prefix, 'manifest.json');
  if (!(await host.exists(manifestFile))) {
    const archive = await fetchArchive({ host, source, directory, setStep });
    await extractArchive({ host, platformKey, archive: archive.file, prefix, env, log, setStep });
    if (archive.temporary) await host.rm(archive.file);
  }
  const manifest = JSON.parse(await host.readFile(manifestFile));
  if (manifest.platform !== platformKey) throw new Error(`Archive Catala pour ${manifest.platform}, attendu ${platformKey}.`);
  if (JSON.stringify(manifest.catala) !== JSON.stringify(recipe.catala)) throw new Error('Version du manifeste Catala inattendue.');
  const pack = archivePack(prefix, platformKey, manifest);
  await setStep('grammaires');
  await host.writeFile(path.join(prefix, ...manifest.topiaryConfig.split('/')), catalaTopiaryConfig(prefix, manifest.grammars));
  return pack;
}

export function catalaCommand(pack, name, args) {
  return { command: pack.bin[name], args };
}

async function probe(host, pack, env, log) {
  for (const name of Object.keys(pack.bin)) {
    if (!(await host.exists(pack.bin[name]))) throw new Error(`${name} absent du pack Catala.`);
  }
  if (!(await host.exists(pack.env.NINJA_BIN))) throw new Error('ninja absent du pack Catala.');
  if (!(await host.exists(path.join(pack.runtimePython, 'catala', 'catala_runtime.py')))) throw new Error('Runtime Python Catala absent du pack.');
  const runEnv = { ...env, ...pack.env, PATH: [...pack.path, env.PATH || ''].join(path.delimiter) };
  const version = catalaCommand(pack, 'catala', ['--version']);
  const result = await required(host, version.command, version.args, { env: runEnv, log }, 'catala --version');
  const proof = catalaCommand(pack, 'catala', ['proof', '--help=plain']);
  await required(host, proof.command, proof.args, { env: runEnv, log, quiet: true }, 'catala proof --help');
  return result.output.trim().split('\n').pop().trim();
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
  let source;
  try {
    source = catalaArchiveSource(recipe, platformKey, env);
  } catch (error) {
    await writeStatus({ state: 'echec', step: 'recette', error: error.message });
    return { state: 'echec', step: 'recette', error: error.message };
  }
  if (!source) {
    const error = `Aucune archive Catala précompilée n’est publiée pour ${platformKey} dans cette version de l’app.`;
    await writeStatus({ state: 'indisponible', error });
    return { state: 'indisponible', error };
  }
  const id = catalaPackId(recipe, platformKey, source);
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
    const pack = await installArchive({ host, platformKey, source, directory, env, log: layout.logFile, setStep, recipe });
    await setStep('verification');
    const version = await probe(host, pack, env, layout.logFile);
    if (version !== recipe.catala.version) throw new Error(`Version Catala inattendue : ${version}.`);
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
