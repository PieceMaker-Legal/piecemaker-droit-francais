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
  await createServer({ root, pm: fakePm }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    return { error: Boolean(result.isError), text: result.content[0].text };
  };
  return { root, calls, call, client };
}

test('the server exposes three tools', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['Feature', 'FeatureComments', 'FeatureData']);
});

test('Feature list, read and open', async () => {
  const { call, calls, root } = await connect();
  const list = JSON.parse((await call('Feature', { action: 'list' })).text);
  assert.ok(list.some((feature) => feature.name === 'reasoning'));
  const read = await call('Feature', { action: 'read', name: 'reasoning' });
  assert.match(read.text, /## Skill piecemaker/);
  assert.match(read.text, /piecemaker\/references\/raisonnement\.md/);
  const reference = await call('Feature', { action: 'read', name: 'reasoning', path: 'piecemaker/references/raisonnement.md' });
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
  assert.equal((await call('FeatureData', { action: 'set', feature: 'reasoning', path: 'notes/n1', data: { a: 1 } })).error, false);
  assert.equal(JSON.parse((await call('FeatureData', { action: 'get', feature: 'reasoning', path: 'notes/n1' })).text).data.a, 1);
  const missing = await call('FeatureData', { action: 'update', feature: 'reasoning', path: 'notes/absent', data: { a: 1 } });
  assert.match(missing.text, /^invalid_argument/);
  const denied = await call('FeatureData', { action: 'set', feature: 'case', path: 'deadlines/assignation', data: { a: 1 } });
  assert.match(denied.text, /^permission_denied/);
  const batch = await call('FeatureData', { action: 'batch', feature: 'reasoning', operations: [{ op: 'delete', path: 'notes/n1' }] });
  assert.equal(batch.error, false);
});

test('FeatureComments read, reply and resolve', async () => {
  const { call, root } = await connect();
  const { openComments } = await import('./store.mjs');
  const thread = await openComments(root).open('reasoning', { tab: 'raisonnement', file: '.piecemaker/raisonnements/assignation.yaml', start: 2, end: 4 }, 'Citer l’article');
  assert.equal(JSON.parse((await call('FeatureComments', { action: 'read', feature: 'reasoning' })).text).length, 1);
  assert.equal((await call('FeatureComments', { action: 'reply', feature: 'reasoning', id: thread.id, text: 'Fait' })).error, false);
  await call('FeatureComments', { action: 'resolve', feature: 'reasoning', id: thread.id });
  assert.equal(JSON.parse((await call('FeatureComments', { action: 'read', feature: 'reasoning' })).text).length, 0);
});

test('Feature run, close and quickstart', async () => {
  const { call, calls, root } = await connect({ pm: undefined });
  assert.equal((await call('Feature', { action: 'run', name: 'reasoning', command: 'verify_reasoning', args: { reasoning: 'assignation' } })).error, false);
  assert.deepEqual(calls[0], ['raisonnement', 'verifier', '--raisonnement', 'assignation', '--dossier', root]);
  assert.match((await call('Feature', { action: 'run', name: 'reasoning', command: 'stamp_exhibits' })).text, /^invalid_argument: unknown command/);
  await call('Feature', { action: 'close', name: 'exhibits' });
  assert.deepEqual(calls[1], ['tab', 'fermer', 'bordereau', '--dossier', root]);
  const { INTENTS } = await import('./server.mjs');
  const { readFeature } = await import('./catalogue.mjs');
  for (const [intent, feature] of Object.entries(INTENTS)) {
    const quick = await call('Feature', { action: 'quickstart', intent, request: 'Préparer le bordereau' });
    assert.equal(quick.error, false);
    const read = readFeature(feature);
    assert.match(quick.text, new RegExp(`# Feature ${feature} `));
    for (const skill of read.skills) assert.ok(quick.text.includes(`## Skill ${skill.name}`));
    for (const command of read.commands) assert.ok(quick.text.includes(`- ${command.name}(`));
    assert.match(quick.text, /## Case state \(pm check\)/);
    assert.ok(quick.text.includes(`1. ${read.start[0]}`));
  }
  assert.deepEqual(calls.at(-1), ['check', '--dossier', root]);
});
