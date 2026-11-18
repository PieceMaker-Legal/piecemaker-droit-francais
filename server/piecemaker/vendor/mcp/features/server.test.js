const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function connect({ pm } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'features-server-'));
  fs.mkdirSync(path.join(root, '.piecemaker'));
  const calls = [];
  const fakePm = pm ?? (async (args) => { calls.push(args); return { code: 0, stdout: `Volet affiché : ${args[2]}`, stderr: '' }; });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createServer } = await import('./server.mjs');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ root, pm: fakePm, relations: ['amends', 'refers-to', 'states', 'involves'] }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    return { error: Boolean(result.isError), text: result.content[0].text };
  };
  return { root, calls, call, client };
}

test('the server exposes four tools', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['Feature', 'FeatureComments', 'FeatureData', 'OkfWrite']);
  assert.doesNotMatch(JSON.stringify(tools), /"items":\[/);
});

test('Feature list, read and open', async () => {
  const { call, calls, root } = await connect();
  const list = JSON.parse((await call('Feature', { action: 'list' })).text);
  assert.ok(list.some((feature) => feature.name === 'exhibits'));
  const read = await call('Feature', { action: 'read', name: 'exhibits' });
  assert.match(read.text, /## Read first\n\n- Feature read exhibits path=piecemaker\/references\/bordereau\.md/);
  assert.doesNotMatch(read.text, /## Skill/);
  const reference = await call('Feature', { action: 'read', name: 'exhibits', path: 'piecemaker/references/bordereau.md' });
  assert.equal(reference.error, false);
  assert.equal((await call('Feature', { action: 'open', name: 'exhibits' })).error, false);
  assert.deepEqual(calls[0], ['tab', 'afficher', 'bordereau', '--dossier', root]);
  assert.equal((await call('Feature', { action: 'open', name: 'projects' })).error, true);
  await call('Feature', { action: 'open', name: 'projects', file: 'Contrat-exemple.docx' });
  assert.deepEqual(calls[1], ['tab', 'afficher', 'fichier', 'Contrat-exemple.docx', '--dossier', root]);
  assert.equal((await call('Feature', { action: 'read', name: 'nothing' })).error, true);
});

test('FeatureData round trip and errors', async () => {
  const { call } = await connect();
  assert.equal((await call('FeatureData', { action: 'set', feature: 'deadlines', collection: 'notes', doc_id: 'n1', data: { a: 1 } })).error, false);
  assert.equal(JSON.parse((await call('FeatureData', { action: 'get', feature: 'deadlines', collection: 'notes', doc_id: 'n1' })).text).data.a, 1);
  assert.match((await call('FeatureData', { action: 'set', feature: 'deadlines', collection: 'notes', doc_id: 'n1', data: { a: 2 } })).text, /^conflict.*if_version/);
  assert.equal((await call('FeatureData', { action: 'update', feature: 'deadlines', collection: 'notes', doc_id: 'n1', data: { a: 2 }, if_version: 1 })).error, false);
  const missing = await call('FeatureData', { action: 'update', feature: 'deadlines', collection: 'notes', doc_id: 'absent', data: { a: 1 } });
  assert.match(missing.text, /^invalid_argument/);
  const denied = await call('FeatureData', { action: 'set', feature: 'case', collection: 'deadlines', doc_id: 'assignation', data: { a: 1 } });
  assert.match(denied.text, /^permission_denied/);
  const query = JSON.parse((await call('FeatureData', { action: 'query', feature: 'deadlines', collection: 'notes', query: { where: [['a', 'eq', 2]] } })).text);
  assert.equal(query.documents.length, 1);
  const batch = await call('FeatureData', { action: 'batch', feature: 'deadlines', writes: [{ op: 'delete', collection: 'notes', doc_id: 'n1', if_version: 2 }] });
  assert.equal(batch.error, false);
});

test('FeatureComments read, reply and resolve', async () => {
  const { call, root } = await connect();
  const { openComments } = await import('./store.mjs');
  const thread = await openComments(root).open('deadlines', { tab: 'suivi_dossiers', file: '.piecemaker/assignation-suivi.json', start: 2, end: 4 }, 'Citer l’article');
  assert.equal(JSON.parse((await call('FeatureComments', { action: 'read', feature: 'deadlines' })).text).length, 1);
  assert.equal((await call('FeatureComments', { action: 'reply', feature: 'deadlines', thread_id: thread.id, text: 'Fait' })).error, false);
  await call('FeatureComments', { action: 'resolve', feature: 'deadlines', thread_id: thread.id });
  const [read] = JSON.parse((await call('FeatureComments', { action: 'read', feature: 'deadlines', thread_id: thread.id })).text);
  assert.equal(read.resolved, true);
  assert.equal(read.messages.length, 2);
});

test('Feature run and quickstart', async () => {
  const { call, calls, root } = await connect({ pm: undefined });
  assert.equal((await call('Feature', { action: 'run', name: 'deadlines', command: 'verify_deadlines', args: { deadlines: 'assignation-suivi.json' } })).error, false);
  assert.deepEqual(calls[0], ['suivi_dossiers', 'verifier', '--suivi', 'assignation-suivi.json', '--dossier', root]);
  assert.match((await call('Feature', { action: 'run', name: 'deadlines', command: 'stamp_exhibits' })).text, /^invalid_argument: unknown command/);
  const { INTENTS } = await import('./server.mjs');
  const { readFeature } = await import('./catalogue.mjs');
  for (const [intent, feature] of Object.entries(INTENTS)) {
    const quick = await call('Feature', { action: 'quickstart', intent });
    assert.equal(quick.error, false);
    const read = readFeature(feature);
    assert.match(quick.text, new RegExp(`# Feature ${feature} `));
    for (const skill of read.skills) assert.ok(quick.text.includes(`path=${skill.references[0] ?? `${skill.name}/SKILL.md`}`));
    for (const command of read.commands) assert.ok(quick.text.includes(`- ${command.name}(`));
    assert.match(quick.text, /## Case state \(pm check\)/);
    assert.ok(read.start.every((call, index) => quick.text.includes(`${index + 1}. ${call}`)));
  }
  assert.deepEqual(calls.at(-1), ['check', '--dossier', root]);
});

test('Feature read projects lists the case files, Word documents first', async () => {
  const { call, root } = await connect();
  fs.mkdirSync(path.join(root, 'Pièces'));
  fs.writeFileSync(path.join(root, 'Pièces', 'Contrat-exemple.pdf'), 'pdf');
  fs.writeFileSync(path.join(root, 'Contrat-exemple.docx'), 'docx');
  fs.writeFileSync(path.join(root, '.cache'), 'x');
  fs.writeFileSync(path.join(root, '.piecemaker', 'notes.md'), 'x');
  const files = (await call('Feature', { action: 'read', name: 'projects' })).text.split('## Files of the case')[1].split('\n').filter((line) => line.startsWith('- '));
  assert.deepEqual(files.map((line) => line.split(' (')[0]), ['- Contrat-exemple.docx', `- ${path.join('Pièces', 'Contrat-exemple.pdf')}`]);
  assert.match(files[0], /\(1 KiB, \d{4}-\d{2}-\d{2}\)$/);
});

test('OkfWrite enforces the ontology and the required fields', async () => {
  const { call, calls, root } = await connect();
  const okf = (...writes) => call('OkfWrite', { writes });
  const result = await okf(
    { action: 'link', source: 'Pièces/avenant.pdf', relation: 'amends', target: 'Pièces/contrat.pdf', citation: 'Le présent avenant modifie le contrat.' },
    { action: 'link', source: 'Loyer mensuel', relation: 'involves', target: 'JEAN_DUPONT' },
    { action: 'mark_examined', source: 'Pièces/note.pdf', reason: 'Aucun lien' },
  );
  assert.equal(result.error, false);
  assert.match(result.text, /^1\. .*\n2\. .*\n3\. /);
  assert.deepEqual(calls, [
    ['okf', 'link', 'Pièces/avenant.pdf', 'amends', 'Pièces/contrat.pdf', '--citation', 'Le présent avenant modifie le contrat.', '--dossier', root],
    ['okf', 'link', 'Loyer mensuel', 'involves', 'JEAN_DUPONT', '--dossier', root],
    ['okf', 'examinee', 'Pièces/note.pdf', '--motif', 'Aucun lien', '--dossier', root],
  ]);
  assert.equal((await okf({ action: 'link', source: 'a', relation: 'contests', target: 'b', citation: 'x' })).error, true);
  assert.match((await okf({ action: 'unlink', source: 'a', relation: 'amends', target: 'b' }, { action: 'link', source: 'a', relation: 'amends', target: 'b' })).text, /^invalid_argument: link needs "citation"/);
  assert.match((await okf({ action: 'mark_examined', source: 'a' })).text, /^invalid_argument/);
  assert.equal((await call('OkfWrite', { writes: [] })).error, true);
  assert.equal(calls.length, 3);
});

test('OkfWrite stops at the first failure', async () => {
  const seen = [];
  const { call } = await connect({ pm: async (args) => { seen.push(args); return seen.length === 2 ? { code: 1, stdout: '', stderr: 'Citation introuvable' } : { code: 0, stdout: 'Lien posé', stderr: '' }; } });
  const link = { action: 'link', source: 'a', relation: 'amends', target: 'b', citation: 'x' };
  const result = await call('OkfWrite', { writes: [link, link, link] });
  assert.equal(result.error, true);
  assert.equal(result.text, '1. Lien posé\n2. Citation introuvable\nStopped: operations 3 to 3 not run.');
  assert.equal(seen.length, 2);
});

test('okfRelations takes the sealed ontology from the server and adds the system relations', async () => {
  const { okfRelations } = await import('./server.mjs');
  const seen = [];
  const pm = async (args) => { seen.push(args); return { code: 0, stdout: JSON.stringify(['contests', 'states', 'involves']), stderr: '' }; };
  assert.deepEqual(await okfRelations('/dossier', pm), ['contests', 'states', 'involves']);
  assert.deepEqual(seen, [['okf', 'ontologie', '--noms', '--dossier', '/dossier']]);
  const down = async () => ({ code: 1, stdout: '', stderr: 'serveur indisponible' });
  assert.deepEqual(await okfRelations('/dossier', down), ['amends', 'responds-to', 'refers-to', 'supersedes', 'states', 'involves']);
});
