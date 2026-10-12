const assert = require('node:assert/strict');
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

test('les outils exposés sont conversion et sql, sans renommage', async () => {
  const { client, close } = await connect({ sqlFn: async () => '' });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['conversion', 'sql', 'volets_ouverts']);
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
