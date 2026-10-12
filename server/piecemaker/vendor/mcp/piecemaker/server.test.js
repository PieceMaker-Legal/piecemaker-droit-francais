const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

async function connect(options) {
  const { createServer } = await import('./server.mjs');
  const server = createServer(options);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

test('les outils exposés sont afficher, chronologie, conversion, sql et tabular_review, sans renommage', async () => {
  const { client, close } = await connect({ sqlFn: async () => '' });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['afficher', 'chronologie', 'conversion', 'sql', 'tabular_review', 'volets_ouverts']);
  const sql = tools.find((tool) => tool.name === 'sql');
  assert.deepEqual(Object.keys(sql.inputSchema.properties), ['requete']);
  assert.deepEqual(sql.annotations, {
    title: 'SQL sur la base PieceMaker',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  });
  assert.ok(sql.description.startsWith('SQL libre (SQLite) sur la base PieceMaker ; noms réels masqués.\n'));
  assert.ok(sql.description.endsWith('Renommer une pièce = UPDATE de son label (AAAA-MM-JJ_titre).'));
  assert.equal(sql.description.split('\n').length, 6);
  await close();
});

test('sql transmet la requête avec le répertoire courant et rend le résultat en texte', async () => {
  const calls = [];
  const { client, close } = await connect({
    sqlFn: async (input) => {
      calls.push(input);
      return 'label\nPERSONNE_1';
    },
  });
  const result = await client.callTool({ name: 'sql', arguments: { requete: 'SELECT label FROM piecemaker_nodes' } });
  assert.deepEqual(calls, [{ requete: 'SELECT label FROM piecemaker_nodes', cwd: process.cwd() }]);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.content, [{ type: 'text', text: 'label\nPERSONNE_1' }]);
  await close();
});

test('sql rend l’erreur du serveur comme erreur MCP', async () => {
  const { client, close } = await connect({
    sqlFn: async () => {
      throw new Error('pas de dossier courant');
    },
  });
  const result = await client.callTool({ name: 'sql', arguments: { requete: 'SELECT dossier()' } });
  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [{ type: 'text', text: 'pas de dossier courant' }]);
  await close();
});

test('chronologie liste les pièces du dossier courant par date', async () => {
  const calls = [];
  const { client, close } = await connect({ sqlFn: async (input) => { calls.push(input); return 'id\tdate'; } });
  const result = await client.callTool({ name: 'chronologie', arguments: { action: 'lister' } });
  assert.equal(result.isError, undefined);
  assert.equal(calls[0].cwd, process.cwd());
  assert.match(calls[0].requete, /^SELECT id, doc_date AS date, label AS libelle/);
  assert.match(calls[0].requete, /project_id = dossier\(\) AND kind = 'document' ORDER BY doc_date IS NULL, doc_date, label$/);
  await close();
});

test('chronologie modifie la date et le libellé en échappant les valeurs', async () => {
  const calls = [];
  const { client, close } = await connect({ sqlFn: async (input) => { calls.push(input); return '1 ligne(s) modifiée(s)'; } });
  await client.callTool({ name: 'chronologie', arguments: { action: 'modifier', dossier: "Société Exemple", piece: "doc:l'acte", date: '2024-03-01', libelle: "2024-03-01_Lettre d'Exemple" } });
  assert.equal(calls[0].requete, "UPDATE piecemaker_nodes SET doc_date = '2024-03-01', label = '2024-03-01_Lettre d''Exemple' WHERE project_id = dossier('Société Exemple') AND kind = 'document' AND id = 'doc:l''acte'");
  await client.callTool({ name: 'chronologie', arguments: { action: 'modifier', piece: 'doc:1', date: '' } });
  assert.equal(calls[1].requete, "UPDATE piecemaker_nodes SET doc_date = NULL WHERE project_id = dossier() AND kind = 'document' AND id = 'doc:1'");
  await close();
});

test('chronologie refuse une modification incomplète ou une date mal formée sans appeler SQL', async () => {
  const calls = [];
  const { client, close } = await connect({ sqlFn: async (input) => { calls.push(input); return ''; } });
  for (const args of [{ action: 'modifier', date: '2024-03-01' }, { action: 'modifier', piece: 'doc:1' }, { action: 'modifier', piece: 'doc:1', date: '01/03/2024' }]) {
    const result = await client.callTool({ name: 'chronologie', arguments: args });
    assert.equal(result.isError, true);
  }
  assert.equal(calls.length, 0);
  await close();
});

test('tabular_review ouvre localement et confie le reste au serveur PieceMaker', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tr-'));
  fs.mkdirSync(path.join(dossier, 'Tabular Review'));
  fs.writeFileSync(path.join(dossier, 'Tabular Review', '26-10-11 - Analyse Tabulaire Baux - Exemple.json'), '{}');
  const calls = [];
  const tabularFn = async (input) => {
    calls.push(input);
    if (input.action === 'lancer') throw new Error('À compléter avant de lancer : documents.');
    return input.action === 'documents' ? ['Pièces/bail.md', 'Pièces/avenant.md'] : { projet: 'p-1' };
  };
  const { client, close } = await connect({ sqlFn: async () => '', tabularFn });
  const opened = await client.callTool({ name: 'tabular_review', arguments: { action: 'ouvrir', dossier, fichier: 'Tabular Review/26-10-11 - Analyse Tabulaire Baux - Exemple.json' } });
  assert.equal(opened.isError, undefined);
  const missing = await client.callTool({ name: 'tabular_review', arguments: { action: 'ouvrir', dossier, fichier: 'absente.json' } });
  assert.equal(missing.isError, true);
  const prepared = await client.callTool({ name: 'tabular_review', arguments: { action: 'preparer', dossier, mode: 'recherche', nom: 'Faute grave', recherche: { query: 'faute', sources: ['cassation'] } } });
  assert.equal(prepared.content[0].text, '{"projet":"p-1"}');
  assert.deepEqual(calls[0], { action: 'preparer', project: dossier, mode: 'recherche', nom: 'Faute grave', recherche: { query: 'faute', sources: ['cassation'] } });
  const documents = await client.callTool({ name: 'tabular_review', arguments: { action: 'documents', dossier } });
  assert.equal(documents.content[0].text, 'Pièces/bail.md\nPièces/avenant.md');
  const launched = await client.callTool({ name: 'tabular_review', arguments: { action: 'lancer', dossier, projet: 'p-1' } });
  assert.equal(launched.isError, true);
  assert.equal(calls.length, 3);
  await close();
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('afficher vérifie le fichier et exige une cible', async () => {
  const { client, close } = await connect({ sqlFn: async () => '' });
  const shown = await client.callTool({ name: 'afficher', arguments: { fichier: __filename } });
  assert.equal(shown.isError, undefined);
  const missing = await client.callTool({ name: 'afficher', arguments: { fichier: 'absent.docx' } });
  assert.equal(missing.isError, true);
  const panel = await client.callTool({ name: 'afficher', arguments: { volet: 'chronologie' } });
  assert.deepEqual(panel.content, [{ type: 'text', text: 'Volet affiché : chronologie' }]);
  const nothing = await client.callTool({ name: 'afficher', arguments: {} });
  assert.equal(nothing.isError, true);
  await close();
});

test('volets_ouverts décrit les volets du dossier de la session', async () => {
  const { describeOpenPanels } = await import('./volets-ouverts.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-volets-'));
  const file = path.join(directory, 'volets-ouverts.json');
  assert.equal(describeOpenPanels('/dossiers/Dupont', file), 'Aucun volet ouvert à côté du chat.');
  fs.writeFileSync(file, JSON.stringify({
    '/dossiers/Dupont': {
      panels: ['plugin:piecemaker-dossier', 'plugin:piecemaker-tabular-review'],
      document: null,
      focus: { 'plugin:piecemaker-dossier': { view: 'chronology' }, 'plugin:piecemaker-tabular-review': { file: '/dossiers/Dupont/Tabular Review/baux.json' } },
      last: { kind: 'panel', tab: 'plugin:piecemaker-tabular-review' },
    },
  }));
  assert.equal(describeOpenPanels('/dossiers/Dupont/Actes', file), [
    'Volets ouverts, dans l’ordre d’ouverture : Dossier (chronologie) ; Analyse tabulaire (fichier : Tabular Review/baux.json).',
    'Document affiché : aucun.',
    'Dernier ouvert, celui que l’avocat regarde : Analyse tabulaire (fichier : Tabular Review/baux.json).',
  ].join('\n'));
  assert.equal(describeOpenPanels('/dossiers/Martin', file), 'Aucun volet ouvert à côté du chat.');
  fs.rmSync(directory, { recursive: true, force: true });
});
