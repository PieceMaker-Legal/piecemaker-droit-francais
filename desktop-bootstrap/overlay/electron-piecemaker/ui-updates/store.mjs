import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeArchive, downloadBytes, MAX_ARCHIVE_BYTES, verifyManifest } from './package.mjs';

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return fallback;
  }
}

async function writeAtomic(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { mode: 0o600 });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(temporary, file);
        break;
      } catch (error) {
        if (attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function createUpdateStore({ directory, config, fetcher, log = console.warn }) {
  await fs.mkdir(directory, { recursive: true });
  const stateFile = path.join(directory, 'state.json');
  const state = await readJson(stateFile, { highest: 0 });
  let files = null;
  let checking;
  let queue = Promise.resolve();
  const serialize = (action) => {
    const operation = queue.then(action);
    queue = operation.catch(() => {});
    return operation;
  };
  const save = () => writeAtomic(stateFile, JSON.stringify(state));

  async function load(envelope) {
    if (!envelope) return null;
    const manifest = verifyManifest(envelope, config);
    const archiveFile = path.join(directory, manifest.archive);
    if ((await fs.stat(archiveFile)).size !== manifest.bytes) throw new Error('Taille de paquet invalide.');
    return decodeArchive(await fs.readFile(archiveFile), manifest);
  }

  async function restore() {
    state.current = state.previous || null;
    state.previous = null;
    state.trial = false;
    try {
      files = await load(state.current);
    } catch {
      state.current = null;
      files = null;
    }
    await save();
  }

  if (state.trial) await restore();
  if (state.pending) {
    try {
      const pendingFiles = await load(state.pending);
      state.previous = state.current;
      state.current = state.pending;
      state.pending = null;
      state.trial = true;
      files = pendingFiles;
      await save();
    } catch (error) {
      log(`[PieceMaker UI] Paquet ignoré : ${error.message}`);
      state.pending = null;
      await save();
    }
  }
  if (!files && state.current) {
    try {
      files = await load(state.current);
    } catch {
      await restore();
    }
  }

  return {
    get files() { return files; },
    get trial() { return Boolean(state.trial); },
    confirm: () => serialize(async () => {
      if (!state.trial) return;
      state.trial = false;
      await save();
    }),
    rollback: () => serialize(restore),
    check: () => {
      checking ??= (async () => {
        const envelope = JSON.parse((await downloadBytes(`${config.feed}/ui-update.json`, 16384, fetcher)).toString());
        const manifest = verifyManifest(envelope, config);
        if (manifest.sequence <= (state.highest || 0)) return false;
        const archive = await downloadBytes(`${config.feed}/${manifest.archive}`, MAX_ARCHIVE_BYTES, fetcher);
        decodeArchive(archive, manifest);
        return serialize(async () => {
          if (manifest.sequence <= (state.highest || 0)) return false;
          await writeAtomic(path.join(directory, manifest.archive), archive);
          state.pending = envelope;
          state.highest = manifest.sequence;
          await save();
          const keep = new Set([state.current, state.previous, state.pending].filter(Boolean).map((item) => verifyManifest(item, config).archive));
          for (const name of await fs.readdir(directory)) {
            if (/^ui-[a-f0-9]{64}\.json\.gz$/.test(name) && !keep.has(name)) await fs.rm(path.join(directory, name));
          }
          return true;
        });
      })().finally(() => { checking = null; });
      return checking;
    },
  };
}
