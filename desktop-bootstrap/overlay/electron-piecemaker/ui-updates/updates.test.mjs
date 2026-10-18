import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { archiveHash, decodeArchive, downloadBytes, verifyManifest } from './package.mjs';
import { createUpdateStore } from './store.mjs';
import { createUiHandler } from './delivery.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const config = { runtime: 'desktop-1.0.0', publicKey, feed: 'https://example.invalid/updates' };

function release(sequence = 1, text = 'Interface', overrides = {}, entries) {
  const archive = gzipSync(JSON.stringify(entries || [['index.html', Buffer.from(text).toString('base64')]]));
  const sha256 = archiveHash(archive);
  const manifest = { format: 1, runtime: config.runtime, sequence, sha256, archive: `ui-${sha256}.json.gz`, bytes: archive.length, ...overrides };
  const payload = JSON.stringify(manifest);
  return { archive, manifest, envelope: { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') } };
}

async function fixture(t, initial = release()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-ui-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let remote = initial;
  let offline = false;
  const requests = [];
  const fetcher = async (url) => {
    requests.push(url);
    if (offline) throw new Error('Offline');
    return new Response(url.endsWith('ui-update.json') ? JSON.stringify(remote.envelope) : remote.archive);
  };
  return {
    directory, requests,
    set remote(value) { remote = value; },
    set offline(value) { offline = value; },
    open: () => createUpdateStore({ directory, config, fetcher, log: () => {} }),
  };
}

test('only signed packages matching the installed runtime are accepted', () => {
  const valid = release();
  assert.equal(verifyManifest(valid.envelope, config).sequence, 1);
  assert.throws(() => verifyManifest({ ...valid.envelope, payload: valid.envelope.payload + ' ' }, config), /Signature/);
  assert.throws(() => verifyManifest(release(2, 'UI', { runtime: 'desktop-2.0.0' }).envelope, config), /incompatible/);
  assert.throws(() => verifyManifest(release(0).envelope, config), /invalide/);
  assert.throws(() => verifyManifest(release(1, 'UI', { archive: '../escape.gz' }).envelope, config), /invalide/);
  assert.throws(() => decodeArchive(Buffer.from('corrupt'), valid.manifest), /altérée/);
});

test('archives reject traversal, duplicate files, invalid base64 and missing index', () => {
  for (const entries of [
    [['../index.html', 'WA==']], [['C:/index.html', 'WA==']], [['a\\b', 'WA==']],
    [['index.html', 'WA=='], ['index.html', 'WQ==']], [['index.html', '***']], [['assets/a.js', 'WA==']],
  ]) {
    const invalid = release(1, '', {}, entries);
    assert.throws(() => decodeArchive(invalid.archive, invalid.manifest));
  }
});

test('downloads require HTTPS and enforce streamed size and HTTP status', async () => {
  await assert.rejects(downloadBytes('http://example.invalid/ui', 2), /HTTPS/);
  await assert.rejects(downloadBytes(config.feed, 2, async () => new Response('123')), /volumineux/);
  await assert.rejects(downloadBytes(config.feed, 2, async () => new Response('', { status: 404 })), /404/);
});

test('large JavaScript bundles decode without recursive regular expression limits', () => {
  const source = Buffer.alloc(5 * 1024 * 1024, 'x');
  const large = release(1, '', {}, [['index.html', 'WA=='], ['assets/main.js', source.toString('base64')]]);
  assert.deepEqual(decodeArchive(large.archive, large.manifest).get('assets/main.js'), source);
});

test('download does not change a running interface; activation waits until the next launch', async (t) => {
  const f = await fixture(t);
  const first = await f.open();
  assert.equal(first.files, null);
  await first.check();
  assert.equal(first.files, null);
  const next = await f.open();
  assert.equal(next.files.get('index.html').toString(), 'Interface');
  assert.equal(next.trial, true);
  await next.confirm();
  f.offline = true;
  const offline = await f.open();
  assert.equal(offline.files.get('index.html').toString(), 'Interface');
  assert.equal(offline.trial, false);
  await assert.rejects(offline.check(), /Offline/);
  assert.equal(offline.files.get('index.html').toString(), 'Interface');
});

test('failed trial restores the previous interface and cannot be replayed', async (t) => {
  const f = await fixture(t, release(10, 'Stable'));
  await (await f.open()).check();
  const stable = await f.open();
  await stable.confirm();
  f.remote = release(11, 'Broken');
  await stable.check();
  const broken = await f.open();
  assert.equal(broken.files.get('index.html').toString(), 'Broken');
  await broken.rollback();
  assert.equal(broken.files.get('index.html').toString(), 'Stable');
  assert.equal(await broken.check(), false);
  f.remote = release(9, 'Older');
  assert.equal(await broken.check(), false);
  assert.equal((await f.open()).files.get('index.html').toString(), 'Stable');
});

test('a process interrupted before confirmation falls back to the embedded interface', async (t) => {
  const f = await fixture(t);
  await (await f.open()).check();
  assert.equal((await f.open()).trial, true);
  const restarted = await f.open();
  assert.equal(restarted.files, null);
  assert.equal(restarted.trial, false);
  assert.equal(await restarted.check(), false);
});

test('tampered cached package falls back safely without requiring network', async (t) => {
  const remote = release();
  const f = await fixture(t, remote);
  await (await f.open()).check();
  await fs.writeFile(path.join(f.directory, remote.manifest.archive), 'corrupt');
  f.offline = true;
  assert.equal((await f.open()).files, null);
});

test('invalid downloads preserve the active interface and do not advance the sequence', async (t) => {
  const f = await fixture(t, release(1, 'Stable'));
  await (await f.open()).check();
  const stable = await f.open();
  await stable.confirm();
  const valid = release(2, 'New');
  f.remote = { ...valid, archive: Buffer.from('corrupt') };
  await assert.rejects(stable.check(), /altérée/);
  f.remote = valid;
  assert.equal(await stable.check(), true);
  assert.equal(stable.files.get('index.html').toString(), 'Stable');
});

test('parallel update checks share a download', async (t) => {
  const f = await fixture(t);
  const initial = await f.open();
  await Promise.all([initial.check(), initial.check()]);
  assert.equal(f.requests.length, 2);
  const trial = await f.open();
  await trial.confirm();
  assert.equal(trial.trial, false);
});

test('a slow network check cannot block trial confirmation', { timeout: 2000 }, async (t) => {
  const f = await fixture(t);
  await (await f.open()).check();
  let unblock;
  const waiting = new Promise((resolve) => { unblock = resolve; });
  const trial = await createUpdateStore({
    directory: f.directory, config,
    fetcher: async () => { await waiting; throw new Error('Offline'); },
  });
  const check = trial.check();
  const rejection = assert.rejects(check, /Offline/);
  try {
    await trial.confirm();
    assert.equal(trial.trial, false);
  } finally {
    unblock();
    await rejection;
  }
});

test('local delivery preserves origin, APIs, HTTP methods and unrelated traffic', async () => {
  const calls = [];
  const files = new Map([['index.html', Buffer.from('<div id="root">UI</div>')], ['assets/main.js', Buffer.from('new UI')]]);
  const handler = createUiHandler({
    getOrigin: () => 'http://localhost:3101', getFiles: () => files,
    forward: async (request) => { calls.push(request); return new Response('backend'); },
  });
  const request = (pathname, options) => new Request(`http://localhost:3101${pathname}`, options);
  const page = await handler(request('/workspace', { headers: { accept: 'text/html' } }));
  assert.match(await page.text(), /UI/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const asset = await handler(request('/assets/main.js'));
  assert.equal(await asset.text(), 'new UI');
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await (await handler(request('/assets/main.js', { method: 'HEAD' }))).text(), '');
  assert.equal((await handler(request('/assets/missing.js'))).status, 404);
  for (const req of [request('/api/projects'), request('/health'), request('/api/data', { method: 'POST', body: 'data' }), new Request('http://example.invalid/')]) {
    assert.equal(await (await handler(req)).text(), 'backend');
  }
  assert.equal(calls.length, 4);
  assert.equal(calls[2].method, 'POST');
  assert.equal(await calls[2].text(), 'data');
  assert.equal((await handler(request('/assets/%5csecret'))).status, 400);
  assert.match(await (await handler(request('/sw.js'))).text(), /skipWaiting/);
});
