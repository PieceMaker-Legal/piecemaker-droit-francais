import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const PREFETCH_TIMEOUT_MS = 40 * 60 * 1000;
const USER_AGENT = 'PieceMaker';

export function checkpointFile(sourceDir) {
  return path.join(sourceDir, 'server', 'piecemaker', 'vendor', 'websocket-server', 'scripts', 'presidio-gliner', 'gliner-checkpoint.json');
}

export async function readCheckpoint(sourceDir, host) {
  const file = checkpointFile(sourceDir);
  const raw = host?.readFile ? await host.readFile(file) : await fs.readFile(file, 'utf8');
  const checkpoint = JSON.parse(raw);
  if (checkpoint.modelId !== 'fastino/gliner2-privacy-filter-PII-multi') {
    throw new Error('Checkpoint GLiNER inattendu.');
  }
  if (!/^[a-f0-9]{40}$/.test(checkpoint.revision)) {
    throw new Error('Révision GLiNER invalide.');
  }
  if (!Array.isArray(checkpoint.files) || checkpoint.files.length === 0) {
    throw new Error('Liste de fichiers GLiNER absente.');
  }
  for (const fileEntry of checkpoint.files) {
    if (!fileEntry?.path || !/^[a-f0-9]{64}$/.test(fileEntry.sha256)) {
      throw new Error(`Fichier de checkpoint GLiNER invalide : ${fileEntry?.path}`);
    }
  }
  return checkpoint;
}

export function glinerAssetName(revision) {
  return `piecemaker-gliner-${revision}.tar.gz`;
}

export function huggingFaceHub(env = process.env, homeDir = os.homedir()) {
  const hfHome = env.HF_HOME || path.join(homeDir, '.cache', 'huggingface');
  return env.HUGGINGFACE_HUB_CACHE || env.HF_HUB_CACHE || path.join(hfHome, 'hub');
}

export function repoFolder(modelId) {
  return `models--${String(modelId).replaceAll('/', '--')}`;
}

export function snapshotDirectory(hub, checkpoint) {
  return path.join(hub, repoFolder(checkpoint.modelId), 'snapshots', checkpoint.revision);
}

export function blobsDirectory(hub, checkpoint) {
  return path.join(hub, repoFolder(checkpoint.modelId), 'blobs');
}

export function refsMainPath(hub, checkpoint) {
  return path.join(hub, repoFolder(checkpoint.modelId), 'refs', 'main');
}

export function prebuiltAssetDir(env, bootstrapHome, tag) {
  return env.PIECEMAKER_PREBUILT_ASSET_DIR || path.join(bootstrapHome, 'prebuilt', tag);
}

export function glinerArchivePath(dir, revision) {
  return path.join(dir, glinerAssetName(revision));
}

export async function isSnapshotComplete(host, hub, checkpoint) {
  const root = snapshotDirectory(hub, checkpoint);
  for (const file of checkpoint.files) {
    if (!(await host.exists(path.join(root, file.path)))) return false;
  }
  return true;
}

function assertSafePath(entry, folder) {
  const prefix = `${folder}/`;
  const normalized = String(entry || '').replace(/\/$/, '');
  if (!normalized || normalized.includes('\\') || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Entrée GLiNER invalide : ${entry}`);
  }
  if (normalized !== folder && !normalized.startsWith(prefix)) {
    throw new Error(`Entrée GLiNER hors préfixe : ${entry}`);
  }
}

export function assertSafeGlinerEntries(entries, details, folder) {
  for (const line of String(details || '').split(/\r?\n/).filter(Boolean)) {
    if (/^l/.test(line)) throw new Error('Archive GLiNER contenant un lien.');
    if (/^h/.test(line)) {
      const target = line.split(/ link to /).pop()?.trim();
      if (!target) throw new Error(`Entrée GLiNER invalide : ${line}`);
      assertSafePath(target, folder);
    }
  }
  for (const raw of String(entries || '').split(/\r?\n/).filter(Boolean)) {
    assertSafePath(raw, folder);
  }
}

export async function writeRefsMain(hub, checkpoint, host) {
  const file = refsMainPath(hub, checkpoint);
  if (host?.mkdir) await host.mkdir(path.dirname(file));
  else await fs.mkdir(path.dirname(file), { recursive: true });
  if (host?.writeFile) await host.writeFile(file, checkpoint.revision);
  else await fs.writeFile(file, checkpoint.revision, { encoding: 'ascii' });
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadToFile(fetchImpl, url, destination, expectedSha) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
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
  const actual = hash.digest('hex');
  if (expectedSha && actual !== expectedSha) {
    await fs.rm(partial, { force: true });
    throw new Error(`Contrôle d'intégrité échoué pour ${path.basename(destination)}.`);
  }
  await fs.rename(partial, destination);
  return actual;
}

function runCommand(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function tarBinary(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return path.join(env.SystemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  }
  return 'tar';
}

async function stagedSource(stagedRepo, checkpoint, file) {
  const fromSnapshot = path.join(stagedRepo, 'snapshots', checkpoint.revision, file.path);
  const fromBlob = path.join(stagedRepo, 'blobs', file.sha256);
  try {
    await fs.access(fromSnapshot);
    return fromSnapshot;
  } catch {
  }
  try {
    await fs.access(fromBlob);
    return fromBlob;
  } catch {
    throw new Error(`Fichier GLiNER absent de l'archive : ${file.path}`);
  }
}

async function placeHubFile(source, blobPath, snapshotPath) {
  await fs.mkdir(path.dirname(blobPath), { recursive: true });
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.copyFile(source, blobPath);
  try {
    await fs.link(blobPath, snapshotPath);
  } catch {
    await fs.copyFile(blobPath, snapshotPath);
  }
}

export async function extractGlinerArchive({ archive, hub, checkpoint, platform = process.platform, env = process.env }) {
  const folder = repoFolder(checkpoint.modelId);
  const tar = tarBinary(platform, env);
  const listed = await runCommand(tar, ['-tzf', archive]);
  if (listed.code !== 0) throw new Error(`Lecture de l'archive GLiNER impossible : ${listed.stderr}`);
  const details = await runCommand(tar, ['-tvzf', archive]);
  assertSafeGlinerEntries(listed.stdout, details.stdout, folder);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-gliner-'));
  try {
    const extracted = await runCommand(tar, ['-xzf', archive, '-C', staging]);
    if (extracted.code !== 0) throw new Error(`Extraction GLiNER impossible : ${extracted.stderr}`);
    const stagedRepo = path.join(staging, folder);
    const destination = snapshotDirectory(hub, checkpoint);
    await fs.rm(destination, { recursive: true, force: true });
    for (const file of checkpoint.files) {
      const source = await stagedSource(stagedRepo, checkpoint, file);
      const digest = await sha256File(source);
      if (digest !== file.sha256) throw new Error(`Intégrité GLiNER invalide : ${file.path}`);
      await placeHubFile(
        source,
        path.join(blobsDirectory(hub, checkpoint), file.sha256),
        path.join(destination, file.path),
      );
    }
    await writeRefsMain(hub, checkpoint);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function cachedCheckpointFile(file, checkpoint, hub) {
  for (const cached of [
    path.join(snapshotDirectory(hub, checkpoint), file.path),
    path.join(blobsDirectory(hub, checkpoint), file.sha256),
  ]) {
    try {
      await fs.access(cached);
      if (await sha256File(cached) === file.sha256) return cached;
    } catch {
    }
  }
  return '';
}

export async function packGlinerCache({ sourceDir, outputDir, fetchImpl = globalThis.fetch, hub = huggingFaceHub() }) {
  const checkpoint = await readCheckpoint(sourceDir);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-gliner-pack-'));
  const folder = repoFolder(checkpoint.modelId);
  const packHub = path.join(work);
  try {
    for (const file of checkpoint.files) {
      const blob = path.join(blobsDirectory(packHub, checkpoint), file.sha256);
      const snapshot = path.join(snapshotDirectory(packHub, checkpoint), file.path);
      const cached = await cachedCheckpointFile(file, checkpoint, hub);
      if (cached) {
        await placeHubFile(cached, blob, snapshot);
        continue;
      }
      const url = `https://huggingface.co/${checkpoint.modelId}/resolve/${checkpoint.revision}/${file.path}`;
      await downloadToFile(fetchImpl, url, blob, file.sha256);
      await fs.mkdir(path.dirname(snapshot), { recursive: true });
      try {
        await fs.link(blob, snapshot);
      } catch {
        await fs.copyFile(blob, snapshot);
      }
    }
    await writeRefsMain(packHub, checkpoint);
    await fs.mkdir(outputDir, { recursive: true });
    const archive = path.join(outputDir, glinerAssetName(checkpoint.revision));
    const packed = await runCommand('tar', ['-czf', archive, '-C', work, folder]);
    if (packed.code !== 0) throw new Error(`Archivage GLiNER impossible : ${packed.stderr}`);
    const listed = await runCommand('tar', ['-tvzf', archive]);
    if (listed.code !== 0) throw new Error(`Lecture de l'archive GLiNER impossible : ${listed.stderr}`);
    assertSafeGlinerEntries(
      (await runCommand('tar', ['-tzf', archive])).stdout,
      listed.stdout,
      folder,
    );
    const digest = await sha256File(archive);
    const size = (await fs.stat(archive)).size;
    if (size > 1.9 * 1024 * 1024 * 1024) {
      await fs.rm(archive, { force: true });
      throw new Error('Archive GLiNER trop volumineuse.');
    }
    await fs.writeFile(`${archive}.sha256`, `${digest}\n`);
    return { archive, sha256: digest, revision: checkpoint.revision, assetName: glinerAssetName(checkpoint.revision), size };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function ensureGlinerArchive({
  sourceDir,
  env = process.env,
  bootstrapHome,
  tag,
  repo,
  fetchImpl = globalThis.fetch,
  timeoutMs = PREFETCH_TIMEOUT_MS,
}) {
  const checkpoint = await readCheckpoint(sourceDir);
  const dir = prebuiltAssetDir(env, bootstrapHome, tag);
  const archive = glinerArchivePath(dir, checkpoint.revision);
  const lock = `${archive}.lock`;
  const pidFile = path.join(dir, 'gliner.pid');
  await fs.mkdir(dir, { recursive: true });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await fs.access(archive);
      return archive;
    } catch {
    }
    let waiting = false;
    try {
      await fs.access(lock);
      waiting = true;
    } catch {
    }
    try {
      const pid = Number(String(await fs.readFile(pidFile, 'utf8')).trim());
      if (Number.isInteger(pid) && pidAlive(pid)) waiting = true;
    } catch {
    }
    if (waiting) {
      await sleep(1000);
      continue;
    }
    break;
  }
  try {
    await fs.access(archive);
    return archive;
  } catch {
  }
  const url = `https://github.com/${repo}/releases/download/${tag}/${glinerAssetName(checkpoint.revision)}`;
  const shaUrl = `${url}.sha256`;
  try {
    await fs.writeFile(lock, `${process.pid}\n`);
    const shaResponse = await fetchImpl(shaUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!shaResponse.ok) return '';
    const expected = String(await shaResponse.text()).trim().split(/\s+/)[0];
    if (!/^[a-fA-F0-9]{64}$/.test(expected)) return '';
    await downloadToFile(fetchImpl, url, archive, expected.toLowerCase());
    await fs.writeFile(`${archive}.sha256`, `${expected.toLowerCase()}\n`);
    return archive;
  } catch {
    try { await fs.rm(archive, { force: true }); } catch { }
    return '';
  } finally {
    try { await fs.rm(lock, { force: true }); } catch { }
  }
}

export async function installGlinerSnapshot({ sourceDir, env = process.env, homeDir = os.homedir(), host, output }) {
  const checkpoint = await readCheckpoint(sourceDir, host);
  const hub = huggingFaceHub(env, homeDir);
  if (await isSnapshotComplete(host, hub, checkpoint)) {
    await writeRefsMain(hub, checkpoint, host);
    output.ok(`Modèle GLiNER déjà présent (${checkpoint.revision.slice(0, 8)}).`);
    return checkpoint;
  }
  const archive = await ensureGlinerArchive({
    sourceDir,
    env,
    bootstrapHome: env.PIECEMAKER_BOOTSTRAP_HOME || path.join(env.PIECEMAKER_HOME || path.join(homeDir, '.piecemaker'), 'bootstrap'),
    tag: env.PIECEMAKER_TAG || '',
    repo: env.PIECEMAKER_REPO || 'PieceMaker-Legal/piecemaker-droit-francais',
    fetchImpl: host.fetch,
  });
  if (archive) {
    output.step('Installation du modèle GLiNER depuis l’archive…');
    await extractGlinerArchive({ archive, hub, checkpoint });
  }
  if (!(await isSnapshotComplete(host, hub, checkpoint))) {
    return checkpoint;
  }
  output.ok(`Modèle GLiNER installé (${checkpoint.revision.slice(0, 8)}).`);
  return checkpoint;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  throw new Error('Utilisez build-gliner-cache.mjs pour produire l’archive.');
}
