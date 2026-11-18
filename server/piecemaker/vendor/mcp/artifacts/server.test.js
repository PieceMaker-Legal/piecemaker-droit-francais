const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PAGE = '<!doctype html><html><head><title>Chronologie du litige</title></head><body><h1>v1</h1></body></html>';

async function connect({ home, plannotator } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-server-'));
  fs.mkdirSync(path.join(root, '.piecemaker'));
  const calls = [];
  const pm = async (args) => { calls.push(args); return { code: 0, stdout: `Volet affiché : ${args[2]}`, stderr: '' }; };
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createServer } = await import('./server.mjs');
  const { openTemplates } = await import('./templates.mjs');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const templates = openTemplates({ home: home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-home-')), env: {} });
  await createServer({ root, pm, templates, ...(plannotator ? { plannotator } : {}) }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    return { error: Boolean(result.isError), text: result.content[0].text };
  };
  const write = (relative, content) => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), content); };
  return { root, calls, call, client, write };
}

const urlIn = (text) => /piecemaker:\/\/artifact\/[a-z0-9-]+/.exec(text)[0];

test('the server exposes the four artifact tools', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['Artifact', 'ArtifactComments', 'ArtifactData', 'ArtifactTemplates']);
});

test('publish creates an artifact titled by its <title>, then adds versions', async () => {
  const { call, write } = await connect();
  write('Artifacts/chrono.html', PAGE);
  write('Artifacts/data.json', '{"events": []}');
  const first = await call('Artifact', { file_path: 'Artifacts/chrono.html', description: 'Les dates du litige.', icon: 'timeline', files: { 'data.json': 'Artifacts/data.json' } });
  assert.equal(first.error, false, first.text);
  const url = urlIn(first.text);
  assert.match(url, /^piecemaker:\/\/artifact\/chronologie-du-litige-[0-9a-f]{6}$/);
  assert.match(first.text, /version 1 of 1/);
  assert.match(first.text, /published: index\.html, data\.json/);

  const second = await call('Artifact', { url, file_path: 'Artifacts/chrono.html', edits: [{ old_str: '<h1>v1</h1>', new_str: '<h1>v2</h1>' }], label: 'Deuxième jet' });
  assert.equal(second.error, false, second.text);
  assert.match(second.text, /version 2 of 2/);
  assert.match(second.text, /data\.json/, 'files left out are kept');

  const read = await call('Artifact', { action: 'read', url });
  assert.match(read.text, /<h1>v2<\/h1>/);
  const old = await call('Artifact', { action: 'read', url, ver: 1 });
  assert.match(old.text, /<h1>v1<\/h1>/);
  const data = await call('Artifact', { action: 'read', url, path: 'data.json' });
  assert.match(data.text, /"events"/);

  const versions = JSON.parse((await call('Artifact', { action: 'list', scope: 'versions', url })).text);
  assert.deepEqual(versions.map((entry) => [entry.version, entry.label]), [[2, 'Deuxième jet'], [1, null]]);
  const listed = JSON.parse((await call('Artifact', { action: 'list' })).text);
  assert.equal(listed[0].url, url);
  assert.equal(listed[0].description, 'Les dates du litige.');
});

test('edits are all or nothing and saved to disk only when published', async () => {
  const { call, write, root } = await connect();
  write('page.html', PAGE);
  const failed = await call('Artifact', { file_path: 'page.html', edits: [{ old_str: '<h1>v1</h1>', new_str: 'x' }, { old_str: 'absent', new_str: 'y' }] });
  assert.equal(failed.error, true);
  assert.match(failed.text, /edit 2: old_str is absent/);
  assert.equal(fs.readFileSync(path.join(root, 'page.html'), 'utf8'), PAGE);
  const ok = await call('Artifact', { file_path: 'page.html', edits: [{ old_str: '<h1>v1</h1>', new_str: '<h1>ok</h1>' }] });
  assert.equal(ok.error, false, ok.text);
  assert.match(fs.readFileSync(path.join(root, 'page.html'), 'utf8'), /<h1>ok<\/h1>/);
});

test('a publish to an artifact this session has not read is refused once, then accepted', async () => {
  const { call, write, root } = await connect();
  write('page.html', PAGE);
  const url = urlIn((await call('Artifact', { file_path: 'page.html' })).text);
  const { createServer } = await import('./server.mjs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ root }).connect(serverSide);
  const other = new Client({ name: 'other', version: '0' });
  await other.connect(clientSide);
  const refused = await other.callTool({ name: 'Artifact', arguments: { url, file_path: 'page.html' } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /neither read nor published in this session/);
  const accepted = await other.callTool({ name: 'Artifact', arguments: { url, file_path: 'page.html' } });
  assert.equal(accepted.isError, false, accepted.content[0].text);
  const stale = await call('Artifact', { url, file_path: 'page.html' });
  assert.equal(stale.error, true);
  assert.match(stale.text, /changed since you read it/);
});

test('files outside the case folder and reserved paths are refused', async () => {
  const { call, write } = await connect();
  write('page.html', PAGE);
  assert.match((await call('Artifact', { file_path: '/etc/hosts' })).text, /outside the case folder|\.html/);
  assert.match((await call('Artifact', { file_path: 'page.html', files: { '../x.js': 'page.html' } })).text, /not a valid published path/);
  assert.match((await call('Artifact', { file_path: 'page.html', files: { 'preflight.js': 'page.html' } })).text, /reserved/);
});

test('quickstart names the bundled templates and type_url creates from one', async () => {
  const { call } = await connect();
  const quick = await call('Artifact', { action: 'quickstart', intent: 'other' });
  assert.match(quick.text, /piecemaker:\/\/template\/tracker/);
  assert.match(quick.text, /creation-artifacts/);
  const created = await call('Artifact', { type_url: 'piecemaker://template/tracker', title: 'Pièces à obtenir' });
  assert.equal(created.error, false, created.text);
  assert.match(created.text, /Read first: README\.md/);
  const url = urlIn(created.text);
  const [summary] = JSON.parse((await call('Artifact', { action: 'list', type: 'piecemaker://template/tracker' })).text);
  assert.equal(summary.url, url);
  assert.deepEqual(summary.capabilities, { db: {} });
});

test('ArtifactData keeps a versioned database per artifact', async () => {
  const { call, write } = await connect();
  write('page.html', PAGE);
  const url = urlIn((await call('Artifact', { file_path: 'page.html' })).text);
  const set = JSON.parse((await call('ArtifactData', { action: 'set', url, collection: 'items', doc_id: 'kbis', data: { text: 'Kbis', done: false } })).text);
  assert.equal(set.version, 1);
  assert.match((await call('ArtifactData', { action: 'update', url, collection: 'items', doc_id: 'kbis', data: { done: true } })).text, /needs if_version/);
  assert.equal(JSON.parse((await call('ArtifactData', { action: 'update', url, collection: 'items', doc_id: 'kbis', data: { done: true }, if_version: 1 })).text).version, 2);
  const query = JSON.parse((await call('ArtifactData', { action: 'query', url, collection: 'items', query: { where: [['done', '==', true]] } })).text);
  assert.equal(query.documents[0].data.text, 'Kbis');
  assert.match((await call('ArtifactData', { action: 'get', url: 'piecemaker://artifact/absent-000000', collection: 'items', doc_id: 'kbis' })).text, /no artifact/);
});

test('ArtifactComments answers threads and turns a finished Plannotator review into one', async () => {
  const started = [];
  const plannotator = { install: async () => ({}), start: (file, resultFile) => { started.push({ file, resultFile }); return { pid: 1 }; } };
  const { call, write, root } = await connect({ plannotator });
  write('page.html', PAGE);
  const url = urlIn((await call('Artifact', { file_path: 'page.html' })).text);
  const annotate = await call('ArtifactComments', { action: 'annotate', url });
  assert.equal(annotate.error, false, annotate.text);
  const review = /thread (pn-[0-9a-f]{8})/.exec(annotate.text)[1];
  assert.match(started[0].file, /index\.html$/);
  assert.deepEqual(JSON.parse((await call('ArtifactComments', { action: 'read', url })).text), []);
  fs.writeFileSync(started[0].resultFile, JSON.stringify({ decision: 'annotated', feedback: 'Ajouter la date de l’assignation.' }));
  const threads = JSON.parse((await call('ArtifactComments', { action: 'read', url })).text);
  assert.equal(threads[0].id, review);
  assert.equal(threads[0].anchor.source, 'plannotator');
  assert.match(threads[0].messages[0].text, /assignation/);
  await call('ArtifactComments', { action: 'reply', url, thread_id: review, text: 'Ajoutée.' });
  const resolved = JSON.parse((await call('ArtifactComments', { action: 'resolve', url, thread_id: review })).text);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.messages.length, 2);
  assert.ok(fs.existsSync(path.join(root, '.piecemaker', 'artifacts', 'comments')));
});

test('open shows the Artifacts tab on the artifact, pin and delete', async () => {
  const { call, write, calls } = await connect();
  write('page.html', PAGE);
  const url = urlIn((await call('Artifact', { file_path: 'page.html' })).text);
  const id = url.split('/').pop();
  await call('Artifact', { action: 'open', url });
  assert.deepEqual(calls[0].slice(0, 4), ['tab', 'afficher', 'artifacts', id]);
  assert.equal(JSON.parse((await call('Artifact', { action: 'pin', url })).text).pinned, true);
  assert.equal(JSON.parse((await call('Artifact', { action: 'list', scope: 'pinned' })).text).length, 1);
  assert.equal(JSON.parse((await call('Artifact', { action: 'delete', url })).text).deleted, true);
  assert.deepEqual(JSON.parse((await call('Artifact', { action: 'list' })).text), []);
});

test('ArtifactTemplates syncs the repository, which wins over the bundled templates, and saves an artifact', async () => {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-remote-'));
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git(['init', '-q', '-b', 'main'], remote);
  fs.mkdirSync(path.join(remote, 'page'));
  fs.writeFileSync(path.join(remote, 'page', 'template.json'), JSON.stringify({ title: 'Page du cabinet', intent: 'other' }));
  fs.writeFileSync(path.join(remote, 'page', 'index.html'), PAGE);
  git(['add', '.'], remote);
  git(['commit', '-q', '-m', 'init'], remote);
  git(['config', 'receive.denyCurrentBranch', 'ignore'], remote);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-home-'));
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 't';
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 't@t';
  const { call, write } = await connect({ home });
  const synced = JSON.parse((await call('ArtifactTemplates', { action: 'sync', repository: remote })).text);
  assert.equal(synced.cloned, true);
  const page = JSON.parse((await call('ArtifactTemplates', { action: 'list', query: 'cabinet' })).text);
  assert.deepEqual(page.map((template) => [template.name, template.source]), [['page', 'repository']]);
  write('page.html', PAGE);
  const url = urlIn((await call('Artifact', { file_path: 'page.html' })).text);
  const saved = JSON.parse((await call('ArtifactTemplates', { action: 'save', url, name: 'chronologie', intent: 'other', readme: '# Chronologie\n' })).text);
  assert.equal(saved.type_url, 'piecemaker://template/chronologie');
  assert.equal(saved.committed, true);
});

test('Plannotator is pinned by checksum and runs without any outgoing call', async () => {
  const { openPlannotator, PLANNOTATOR, PRIVATE_ENV, platformKey } = await import('./plannotator.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plannotator-home-'));
  const bytes = Buffer.from('binary');
  const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes });
  const wrong = openPlannotator({ home, fetchImpl, platform: 'linux', arch: 'x64', env: {} });
  await assert.rejects(() => wrong.install(), /checksum mismatch/);
  assert.equal(wrong.status().installed, false);
  PLANNOTATOR.sha256['linux-x64'] = createHash('sha256').update(bytes).digest('hex');
  const spawned = [];
  const spawnImpl = (bin, args, options) => { spawned.push({ bin, args, env: options.env }); return { pid: 7, unref() {} }; };
  const right = openPlannotator({ home, fetchImpl, spawnImpl, platform: 'linux', arch: 'x64', env: {} });
  assert.equal((await right.install()).installed, true);
  right.start('/case/index.html', '/case/result.json');
  assert.deepEqual(spawned[0].args, ['annotate', '/case/index.html', '--gate', '--json', '--no-jina', '--result-file', '/case/result.json', '--render-html']);
  for (const [name, value] of Object.entries(PRIVATE_ENV)) assert.equal(spawned[0].env[name], value);
  assert.equal(platformKey('freebsd', 'x64'), null);
});
