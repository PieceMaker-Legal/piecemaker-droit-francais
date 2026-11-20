const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PAGE = '<!doctype html><html><head><title>Chronologie du litige</title></head><body><h1>v1</h1></body></html>';

async function connect({ home, root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-server-')) } = {}) {
  fs.mkdirSync(path.join(root, '.piecemaker'), { recursive: true });
  const calls = [];
  const pm = async (args) => { calls.push(args); return { code: 0, stdout: `Volet affiché : ${args[2]}`, stderr: '' }; };
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createServer } = await import('./server.mjs');
  const { openTemplates } = await import('./templates.mjs');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const templates = openTemplates({ home: home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-home-')), env: {} });
  await createServer({ root, pm, templates }).connect(serverSide);
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

test('the project view keeps one editable HTML history per project across MCP sessions', async () => {
  const first = await connect();
  const second = await connect();
  const url = 'piecemaker://artifact/vue-personnalisee';
  first.write('page.html', PAGE);
  first.write('widget.js', 'window.widget = true;');
  const saved = await first.call('Artifact', {
    action: 'save_view', file_path: 'page.html', files: { 'widget.js': 'widget.js' }, capabilities: { db: {} },
  });
  assert.equal(saved.error, false, saved.text);
  assert.equal(urlIn(saved.text), url);
  assert.match((await second.call('Artifact', { action: 'read', url })).text, /not_found/);
  assert.deepEqual(JSON.parse((await first.call('Artifact', { action: 'list' })).text), []);
  assert.match((await first.call('Artifact', { action: 'open', url })).text, /Agent › Vue personnalisée/);
  assert.deepEqual(first.calls, []);

  const metadata = path.join(first.root, '.piecemaker', 'artifacts', 'items', url.split('/').at(-1), 'artifact.json');
  const legacyView = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  delete legacyView.tag;
  fs.writeFileSync(metadata, JSON.stringify(legacyView));

  const reopened = await connect({ root: first.root });
  assert.deepEqual(JSON.parse((await reopened.call('Artifact', { action: 'list' })).text), []);
  assert.match((await reopened.call('Artifact', { action: 'read', url })).text, /<h1>v1<\/h1>/);
  const edited = await reopened.call('Artifact', {
    action: 'save_view', file_path: 'page.html', edits: [{ old_str: '<h1>v1</h1>', new_str: '<h1>v2</h1>' }],
  });
  assert.equal(edited.error, false, edited.text);
  assert.equal(urlIn(edited.text), url);
  assert.equal(JSON.parse(fs.readFileSync(metadata, 'utf8')).tag, 'agent-custom-view');
  assert.match((await first.call('Artifact', { action: 'read', url })).text, /<h1>v2<\/h1>/);
  assert.match((await first.call('Artifact', { action: 'read', url, path: 'widget.js' })).text, /window.widget = true/);
  assert.match((await first.call('Artifact', { action: 'read', url, ver: 1 })).text, /<h1>v1<\/h1>/);
});

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

test('ArtifactComments opens the requested version and reads and answers saved review threads', async () => {
  const { call, write, calls, root } = await connect();
  write('page.html', PAGE);
  const url = urlIn((await call('Artifact', { file_path: 'page.html' })).text);
  const id = url.split('/').pop();
  write('page.html', PAGE.replace('v1', 'v2'));
  await call('Artifact', { url, file_path: 'page.html' });

  const annotate = await call('ArtifactComments', { action: 'annotate', url, ver: 1 });
  assert.equal(annotate.error, false, annotate.text);
  assert.deepEqual(calls[0].slice(0, 4), ['tab', 'afficher', 'artifacts', `${id}@v1`]);
  assert.equal((await call('ArtifactComments', { action: 'annotate', url, ver: 99 })).error, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse((await call('ArtifactComments', { action: 'read', url })).text), []);

  const { openArtifactReviews } = await import('./reviews.mjs');
  const native = openArtifactReviews(root);
  const passage = { quote: 'v1', start: 0, before: '', after: '' };
  const annotation = await native.comment(id, { text: 'Préciser la date.', anchor: { version: 1, passage } });
  await native.decide(id, { version: 1, decision: 'changes_requested', text: 'Vérifier la chronologie.' });
  await native.decide(id, { version: 2, decision: 'approved' });

  const threads = JSON.parse((await call('ArtifactComments', { action: 'read', url })).text);
  assert.deepEqual(threads.map(({ anchor }) => anchor.version), [1, 1, 2]);
  assert.deepEqual(threads[0].anchor.passage, passage);
  assert.equal(threads[1].anchor.decision, 'changes_requested');
  assert.equal(threads[1].messages[0].text, 'Vérifier la chronologie.');
  assert.equal(threads[2].anchor.decision, 'approved');
  await call('ArtifactComments', { action: 'reply', url, thread_id: annotation.id, text: 'Ajoutée.' });
  await call('ArtifactComments', { action: 'resolve', url, thread_id: annotation.id });
  const [resolved] = JSON.parse((await call('ArtifactComments', { action: 'read', url, thread_id: annotation.id })).text);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.messages[1].text, 'Ajoutée.');
});

test('ArtifactComments recovers older completed reviews once, using files within the case', async () => {
  const { call, write } = await connect();
  write('page.html', PAGE);
  const url = urlIn((await call('Artifact', { file_path: 'page.html' })).text);
  const folder = `.piecemaker/artifacts/reviews/${url.split('/').pop()}`;
  write(`${folder}/previous.review.json`, JSON.stringify({ version: 1, result_file: '/old-location/result.json' }));
  write(`${folder}/previous.result.json`, JSON.stringify({ decision: 'annotated', feedback: 'Revoir la date.' }));
  write(`${folder}/dismissed.review.json`, JSON.stringify({ version: 1 }));
  write(`${folder}/dismissed.result.json`, JSON.stringify({ decision: 'dismissed' }));
  const first = JSON.parse((await call('ArtifactComments', { action: 'read', url })).text);
  assert.equal(first.length, 1);
  assert.equal(first[0].anchor.decision, 'changes_requested');
  assert.equal(first[0].messages[0].text, 'Revoir la date.');
  assert.deepEqual(JSON.parse((await call('ArtifactComments', { action: 'read', url })).text), first);
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

test('a template script runs in the PieceMaker Python environment and is never copied into the artifact', async () => {
  const { call, write, root } = await connect();
  const created = await call('Artifact', { type_url: 'piecemaker://template/chronologie', title: 'Chronologie' });
  assert.equal(created.error, false, created.text);
  assert.match(created.text, /ArtifactTemplates read type_url=piecemaker:\/\/template\/chronologie path=references\/format\.md/);
  assert.match(created.text, /- build \(<événements\.json\|csv>\): .* → ArtifactTemplates run/);
  const url = urlIn(created.text);
  const files = JSON.parse((await call('Artifact', { action: 'list', scope: 'files', url })).text).map((file) => file.path);
  assert.deepEqual(files, ['index.html', 'data.js']);

  write('evenements.csv', 'date;titre;piece\n2026-02-01;Assignation;Pièce 4\n2026-01-10;Contrat signé;Pièce 1\n');
  const run = await call('ArtifactTemplates', { action: 'run', url, script: 'build', args: ['evenements.csv'] });
  assert.equal(run.error, false, run.text);
  assert.match(run.text, /exit code 0/);
  assert.match(run.text, /2 événement\(s\)/);
  const data = fs.readFileSync(path.join(root, 'Artifacts', 'chronologie', 'data.js'), 'utf8');
  assert.ok(data.indexOf('Contrat signé') < data.indexOf('Assignation'), 'sorted by date');
  const published = await call('Artifact', { url, files: { 'data.js': 'Artifacts/chronologie/data.js' } });
  assert.equal(published.error, false, published.text);
  assert.match(published.text, /version 2 of 2/);

  write('mauvais.json', JSON.stringify([{ date: 'hier', titre: 'x' }]));
  const failed = await call('ArtifactTemplates', { action: 'run', url, script: 'build', args: ['mauvais.json'] });
  assert.equal(failed.error, true);
  assert.match(failed.text, /ligne 1/);
  assert.match((await call('ArtifactTemplates', { action: 'run', url, script: 'absent' })).text, /declares build/);
});

test('the Python interpreter is resolved like the conversion pipeline', async () => {
  const { piecemakerPython } = await import('./python.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-python-'));
  assert.equal(piecemakerPython({ home, env: {}, platform: 'linux' }), 'python3');
  assert.equal(piecemakerPython({ home, env: { PYTHON_PATH: '/opt/py' }, platform: 'linux' }), '/opt/py');
  fs.mkdirSync(path.join(home, 'venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'venv', 'bin', 'python'), '');
  assert.equal(piecemakerPython({ home, env: {}, platform: 'linux' }), path.join(home, 'venv', 'bin', 'python'));
  const shared = path.join(home, 'shared-python');
  fs.writeFileSync(shared, '');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ pythonPath: shared, pythonRuntime: { kind: 'shared' } }));
  assert.equal(piecemakerPython({ home, env: { PYTHON_PATH: '/opt/py' }, platform: 'linux' }), shared);
  fs.rmSync(shared);
  assert.throws(() => piecemakerPython({ home, env: {}, platform: 'linux' }), /shared PieceMaker Python environment is missing/);
});

test('a Word artifact refers to the editable project document and deletes only the artifact', async () => {
  const { call, write, root } = await connect();
  const document = 'Artifacts/rapport-fictif.docx';
  write(document, Buffer.from('PK\x03\x04version initiale'));
  const result = await call('Artifact', { file_path: document, title: 'Rapport fictif' });
  assert.equal(result.error, false, result.text);
  const url = urlIn(result.text);
  const [artifact] = JSON.parse((await call('Artifact', { action: 'list' })).text);
  assert.equal(artifact.format, 'docx');
  const source = path.join(root, document);
  const updated = Buffer.from('PK\x03\x04version enregistrée');
  fs.writeFileSync(source, updated);
  const read = await call('Artifact', { action: 'read', url });
  assert.match(read.text, /saved at: Artifacts[\\/]rapport-fictif\.docx/);
  assert.match(read.text, new RegExp(`, ${updated.length} bytes`));
  assert.equal((await call('Artifact', { action: 'delete', url })).error, false);
  assert.deepEqual(fs.readFileSync(source), updated);

  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-external-'));
  try {
    fs.writeFileSync(path.join(external, 'externe.docx'), updated);
    fs.symlinkSync(external, path.join(root, 'lien'), 'junction');
    const refused = await call('Artifact', { file_path: 'lien/externe.docx' });
    assert.equal(refused.error, true);
    assert.match(refused.text, /permission_denied/);
  } finally {
    fs.rmSync(external, { recursive: true, force: true });
  }
});
