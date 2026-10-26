import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MINGIT, MINGIT_DIR, embedMinGit } from './mingit.mjs';

async function stage(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-mingit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ build: { files: ['server/**'] } }));
  return directory;
}

const fakeExtract = async (_archive, destination) => {
  await fs.mkdir(path.join(destination, 'cmd'), { recursive: true });
  await fs.writeFile(path.join(destination, 'cmd', 'git.exe'), '');
};

test('rejects an archive whose checksum does not match the pinned MinGit', async (t) => {
  const directory = await stage(t);
  const fetchImpl = async () => new Response('not mingit');
  await assert.rejects(embedMinGit(directory, { fetchImpl, extract: fakeExtract }), /SHA-256/);
  await assert.rejects(fs.access(path.join(directory, MINGIT_DIR)));
});

test('ships the extracted MinGit as an extra resource next to the app', async (t) => {
  const directory = await stage(t);
  const bytes = Buffer.from('fixture archive');
  const pinned = { ...MINGIT };
  MINGIT.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  t.after(() => Object.assign(MINGIT, pinned));
  await embedMinGit(directory, { fetchImpl: async () => new Response(bytes), extract: fakeExtract });
  await embedMinGit(directory, { fetchImpl: async () => new Response(bytes), extract: fakeExtract });
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.build.extraResources, [{ from: MINGIT_DIR, to: MINGIT_DIR }]);
  await fs.access(path.join(directory, MINGIT_DIR, 'cmd', 'git.exe'));
  await assert.rejects(fs.access(path.join(directory, 'mingit.zip')));
});
