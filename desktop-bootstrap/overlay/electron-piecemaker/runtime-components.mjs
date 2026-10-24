import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-f0-9]{64}$/;

function validateManifest(manifest) {
  if (!manifest || typeof manifest.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repository)) throw new Error('Invalid runtime components repository.');
  if (typeof manifest.releaseTag !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(manifest.releaseTag)) throw new Error('Invalid runtime components release tag.');
  if (!Array.isArray(manifest.components)) throw new Error('Invalid runtime components list.');
  for (const component of manifest.components) {
    if (!ID_PATTERN.test(component.id) || !HASH_PATTERN.test(component.sha256)) throw new Error('Invalid runtime component hash.');
    if (typeof component.assetName !== 'string' || !/^piecemaker-runtime-components-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+-[a-f0-9]{64}\.tar\.gz$/.test(component.assetName)) throw new Error('Invalid runtime component asset name.');
    if (component.id !== component.assetName.match(/-([a-f0-9]{64})\.tar\.gz$/)?.[1]) throw new Error('Runtime component id does not match its asset.');
    if (!Array.isArray(component.packageNames) || component.packageNames.length === 0 || component.packageNames.some((name) => typeof name !== 'string' || !/^@(openai|anthropic-ai)\/[A-Za-z0-9_.-]+$/.test(name)) || new Set(component.packageNames).size !== component.packageNames.length) throw new Error('Invalid runtime component package list.');
    if (component.packageManifests !== undefined) {
      if (!component.packageManifests || typeof component.packageManifests !== 'object' || Array.isArray(component.packageManifests)) throw new Error('Invalid runtime component package metadata.');
      for (const [installedName, metadata] of Object.entries(component.packageManifests)) {
        if (!component.packageNames.includes(installedName) || !metadata || typeof metadata.name !== 'string' || typeof metadata.version !== 'string') throw new Error('Invalid runtime component package metadata.');
      }
    }
  }
}

export function assertSafeTarEntries(output, verboseOutput = '', packageNames = []) {
  if (verboseOutput.split(/\r?\n/).some((line) => /^[lh]/.test(line))) throw new Error('Runtime component archive contains a link.');
  const allowedPackages = new Set(packageNames.map((name) => `node_modules/${name}`));
  for (const raw of output.split(/\r?\n/).filter(Boolean)) {
    if (raw.includes('\\')) throw new Error(`Unsafe runtime component archive entry: ${raw}`);
    const entry = raw.replace(/\/$/, '');
    const parts = entry.split('/');
    if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry) || parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe runtime component archive entry: ${raw}`);
    if (entry === 'node_modules' || entry === 'node_modules/@openai' || entry === 'node_modules/@anthropic-ai') continue;
    if (parts[0] !== 'node_modules' || !allowedPackages.has(parts.slice(0, 3).join('/'))) throw new Error(`Unexpected runtime component archive entry: ${raw}`);
  }
}

function runTar(tarCommand, args, cwd) {
  const result = spawnSync(tarCommand, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `tar exited with status ${result.status}`);
  return result.stdout;
}

async function renameDirectory(source, target) {
  let error;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.promises.rename(source, target);
      return;
    } catch (caught) {
      error = caught;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(caught.code)) throw caught;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw error;
}

async function writeResponse(response, target) {
  if (!response.ok || !response.body) throw new Error(`Runtime component download failed: HTTP ${response.status}.`);
  const readable = typeof response.body.getReader === 'function' ? Readable.fromWeb(response.body) : response.body;
  await pipeline(readable, createWriteStream(target, { flags: 'wx' }));
}

async function digestFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function digestRuntimeComponent(modules, relativePaths) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
      else if (entry.isSymbolicLink()) throw new Error('Runtime component archive contains a symbolic link.');
    }
  };
  for (const relativePath of relativePaths) visit(path.join(modules, ...relativePath.split('/')));
  files.sort((left, right) => {
    const a = path.relative(modules, left).split(path.sep).join('/');
    const b = path.relative(modules, right).split(path.sep).join('/');
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(modules, file).split(path.sep).join('/')).update('\0');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function cacheReady(directory, component) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(directory, '.runtime-component.json'), 'utf8'));
    if (marker.id !== component.id || !HASH_PATTERN.test(marker.sha256)) return false;
    for (const packageName of component.packageNames) {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8'));
      const expected = component.packageManifests?.[packageName] || { name: packageName };
      if (manifest.name !== expected.name || (expected.version && manifest.version !== expected.version)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function removeAbandonedDownloads(cacheRoot, log) {
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    const match = entry.name.match(/^\.runtime-download-([1-9]\d*)-([A-Za-z0-9]{6})$/);
    if (!match || !entry.isDirectory()) continue;
    const directory = path.join(cacheRoot, entry.name);
    try {
      const markerPath = path.join(directory, 'owner.json');
      if (!fs.lstatSync(markerPath).isFile()) continue;
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.format !== 1 || marker.owner !== 'piecemaker-runtime-download' || marker.pid !== Number(match[1]) || !Number.isSafeInteger(marker.pid)) continue;
      if (fs.readdirSync(directory).some((name) => !['owner.json', 'component.partial', 'extracting'].includes(name))) continue;
      try {
        process.kill(marker.pid, 0);
        continue;
      } catch (error) {
        if (error.code !== 'ESRCH') continue;
      }
      fs.rmSync(directory, { recursive: true, force: true });
      log(`Removed abandoned runtime component download: ${entry.name}`);
    } catch (error) {
      log(`Runtime component download cleanup skipped: ${entry.name}: ${error.message}`);
    }
  }
}

export async function ensureRuntimeComponents({
  manifest,
  cacheRoot,
  fetchImpl = fetch,
  tarCommand = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar',
  log = () => {},
  assetDir = process.env.PIECEMAKER_PREBUILT_ASSET_DIR,
}) {
  validateManifest(manifest);
  fs.mkdirSync(cacheRoot, { recursive: true });
  removeAbandonedDownloads(cacheRoot, log);
  const moduleRoots = [];
  for (const component of manifest.components) {
    const destination = path.join(cacheRoot, component.id);
    if (cacheReady(destination, component)) {
      log(`Runtime component cache hit: ${component.id}`);
    } else {
      const nonce = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
      const transaction = fs.mkdtempSync(path.join(cacheRoot, `.runtime-download-${process.pid}-`));
      const partial = path.join(transaction, 'component.partial');
      const staging = path.join(transaction, 'extracting');
      const backup = path.join(cacheRoot, `.${component.id}.${nonce}.previous`);
      const url = `https://github.com/${manifest.repository}/releases/download/${encodeURIComponent(manifest.releaseTag)}/${encodeURIComponent(component.assetName)}`;
      try {
        fs.writeFileSync(path.join(transaction, 'owner.json'), JSON.stringify({ format: 1, owner: 'piecemaker-runtime-download', pid: process.pid }), { flag: 'wx' });
        const prefetched = assetDir ? path.join(assetDir, component.assetName) : '';
        let archive = partial;
        if (prefetched && fs.existsSync(prefetched)) {
          log(`Using prefetched runtime component: ${component.assetName}`);
          archive = prefetched;
        } else {
          log(`Downloading runtime component: ${component.id}`);
          const response = await fetchImpl(url);
          await writeResponse(response, partial);
        }
        if (await digestFile(archive) !== component.sha256) throw new Error('Runtime component checksum mismatch.');
        log(`Extracting runtime component: ${component.id}`);
        const entries = runTar(tarCommand, ['-tzf', archive], cacheRoot);
        const details = runTar(tarCommand, ['-tvzf', archive], cacheRoot);
        assertSafeTarEntries(entries, details, component.packageNames);
        fs.mkdirSync(staging, { recursive: false });
        runTar(tarCommand, ['-xzf', archive, '-C', staging], cacheRoot);
        const modules = path.join(staging, 'node_modules');
        for (const packageName of component.packageNames) {
          const packageDir = path.join(modules, ...packageName.split('/'));
          const packageManifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
          const expected = component.packageManifests?.[packageName] || { name: packageName };
          if (packageManifest.name !== expected.name || (expected.version && packageManifest.version !== expected.version)) throw new Error(`Runtime component package mismatch: ${packageName}.`);
        }
        if (await digestRuntimeComponent(modules, component.packageNames) !== component.id) throw new Error('Runtime component content hash mismatch.');
        fs.writeFileSync(path.join(staging, '.runtime-component.json'), JSON.stringify({ id: component.id, sha256: component.sha256 }));
        if (!cacheReady(destination, component)) {
          if (fs.existsSync(destination)) await renameDirectory(destination, backup);
          try {
            await renameDirectory(staging, destination);
          } catch (error) {
            if (!cacheReady(destination, component)) {
              if (fs.existsSync(backup)) await renameDirectory(backup, destination);
              throw error;
            }
            fs.rmSync(backup, { recursive: true, force: true });
            fs.rmSync(staging, { recursive: true, force: true });
          }
          fs.rmSync(backup, { recursive: true, force: true });
          log(`Runtime component ready: ${component.id}`);
        }
      } finally {
        fs.rmSync(transaction, { recursive: true, force: true });
        if (fs.existsSync(backup) && !fs.existsSync(destination)) await renameDirectory(backup, destination);
        else fs.rmSync(backup, { recursive: true, force: true });
      }
    }
    moduleRoots.push(path.join(destination, 'node_modules'));
  }
  return { moduleRoots, components: manifest.components.map(({ id, packageNames }) => ({ id, packageNames })) };
}
