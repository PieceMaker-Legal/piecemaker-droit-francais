import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import { createSqlTool } from '../sql-tool.js';

const PROJECT_ONE = 'a1b2c3d4-aaaa-4000-8000-000000000001';
const PROJECT_TWO = '3f2a9c11-bbbb-4000-8000-000000000002';
const PROJECT_THREE = '7b01de22-cccc-4000-8000-000000000003';
const PERSON = 'entity:PERSONNE_PHYSIQUE_01';
const COMPANY = 'entity:PERSONNE_MORALE_01';
const PIECE = 'document:piece-1';
const PASSWORD_HASH = 'hash-secret-123456';
const API_KEY = 'sk-api-secret-987654';

type Renamer = (projectId: string, piecePath: string, name: string) => Promise<{ previous: string; current: string }>;
type Fixture = {
  directory: string;
  roots: Record<string, string>;
  appDb: InstanceType<typeof Database>;
  store: KnowledgeStore;
  tool: ReturnType<typeof createSqlTool>;
  calls: Array<[string, string, string]>;
  setRenamer(renamer: Renamer): void;
  setNow(value: Date): void;
  run(requete: string, cwd?: string | null): Promise<string>;
  rows(sql: string, ...parameters: unknown[]): Array<Record<string, unknown>>;
  exclusions(): { values: string[]; liens: Array<Record<string, string>> };
  cleanup(): void;
};

function fixture(): Fixture {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-sql-tool-')));
  const termsFile = path.join(directory, 'institutional-terms.json');
  process.env.PIECEMAKER_INSTITUTIONAL_TERMS = termsFile;
  const roots = { one: path.join(directory, 'dupont-martin'), two: path.join(directory, 'exemple'), three: path.join(directory, 'dupont-bis') };
  for (const root of Object.values(roots)) fs.mkdirSync(path.join(root, 'sous', 'dossier'), { recursive: true });
  const databasePath = path.join(directory, 'auth.db');
  const appDb = new Database(databasePath);
  appDb.exec(`CREATE TABLE projects (project_id TEXT PRIMARY KEY NOT NULL, project_path TEXT NOT NULL UNIQUE, custom_project_name TEXT DEFAULT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
    CREATE TABLE api_keys (id INTEGER PRIMARY KEY, key_name TEXT, api_key TEXT);
    CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  appDb.prepare('INSERT INTO users(username, password_hash) VALUES (?, ?)').run('avocat', PASSWORD_HASH);
  appDb.prepare('INSERT INTO api_keys(key_name, api_key) VALUES (?, ?)').run('cle', API_KEY);
  appDb.prepare('INSERT INTO app_config(key, value) VALUES (?, ?)').run('jwt_secret', 'jwt-secret-abcdef123456');
  const insertProject = appDb.prepare('INSERT INTO projects(project_id, project_path, custom_project_name) VALUES (?, ?, ?)');
  insertProject.run(PROJECT_ONE, roots.one, 'Dupont c. Martin');
  insertProject.run(PROJECT_TWO, roots.two, 'Société Exemple');
  insertProject.run(PROJECT_THREE, roots.three, null);
  const store = new KnowledgeStore(appDb);
  store.update({ projectId: PROJECT_ONE, operations: [
    { op: 'upsertNode', node: { id: PERSON, kind: 'person', label: 'Jean Dupont', aliases: ['Dupont'], data: { code: 'PERSONNE_PHYSIQUE_01' } } },
    { op: 'upsertMapping', mapping: { nodeId: PERSON, real: 'Jean Dupont', masked: 'PERSONNE_PHYSIQUE_01' } },
    { op: 'upsertMapping', mapping: { nodeId: PERSON, real: 'Dupont', masked: 'PERSONNE_PHYSIQUE_01' } },
    { op: 'upsertNode', node: { id: 'entity:PERSONNE_PHYSIQUE_02', kind: 'person', label: "Jean D'Arc", data: { code: 'PERSONNE_PHYSIQUE_02' } } },
    { op: 'upsertMapping', mapping: { nodeId: 'entity:PERSONNE_PHYSIQUE_02', real: "Jean D'Arc", masked: 'PERSONNE_PHYSIQUE_02' } },
    { op: 'upsertNode', node: { id: COMPANY, kind: 'company', label: 'Société Exemple SAS', aliases: ['Société Exemple'], data: { code: 'PERSONNE_MORALE_01' } } },
    { op: 'upsertMapping', mapping: { nodeId: COMPANY, real: 'Société Exemple SAS', masked: 'PERSONNE_MORALE_01' } },
    { op: 'upsertMapping', mapping: { nodeId: COMPANY, real: 'Société Exemple', masked: 'PERSONNE_MORALE_01' } },
    { op: 'upsertNode', node: { id: PIECE, kind: 'document', label: '2024-01-09_Facture.pdf', data: { path: path.join(roots.one, '2024-01-09_Facture.pdf') }, date: '2024-01-09' } },
    { op: 'upsertNode', node: { id: 'document:piece-2', kind: 'document', label: '2024-02-01_Courrier.pdf', data: {} } },
    { op: 'upsertNode', node: { id: 'document:fuite', kind: 'document', label: `copie ${API_KEY} ici`, data: {} } },
    { op: 'link', link: { fromNodeId: PIECE, toNodeId: PERSON, relation: 'mentions' } },
    { op: 'link', link: { fromNodeId: PIECE, toNodeId: COMPANY, relation: 'mentions' } },
    { op: 'cite', citation: { fromNodeId: PIECE, toNodeId: PERSON, relation: 'mentions', texte: 'Facture adressée à Jean Dupont.', pieceId: PIECE } },
  ] });

  const calls: Array<[string, string, string]> = [];
  let renamer: Renamer = async () => { throw new Error('renommage non prévu'); };
  let current = new Date('2026-10-05T10:00:00Z');
  const tool = createSqlTool({
    databasePath,
    dataRoot: directory,
    now: () => current,
    rename: async (projectId, piecePath, name) => { calls.push([projectId, piecePath, name]); return renamer(projectId, piecePath, name); },
  });
  const rows = (sql: string, ...parameters: unknown[]) => appDb.prepare(sql).all(...parameters) as Array<Record<string, unknown>>;
  return {
    directory,
    roots,
    appDb,
    store,
    tool,
    calls,
    setRenamer: (value) => { renamer = value; },
    setNow: (value) => { current = value; },
    run: (requete, cwd) => tool.execute({ requete, cwd: cwd === undefined ? roots.one : cwd ?? undefined }),
    rows,
    exclusions: () => {
      const row = rows("SELECT data_json FROM piecemaker_nodes WHERE project_id=? AND id='system:gliner-exclusions'", PROJECT_ONE)[0];
      const data = row ? JSON.parse(String(row.data_json)) as { values?: string[]; liens?: Array<Record<string, string>> } : {};
      return { values: data.values ?? [], liens: data.liens ?? [] };
    },
    cleanup: () => {
      delete process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
      try { tool.close(); } catch {}
      appDb.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function withFixture(body: (context: Fixture) => Promise<void>): Promise<void> {
  const context = fixture();
  try {
    await body(context);
  } finally {
    context.cleanup();
  }
}

test('refuse toute requête qui nomme une table de secrets, quelle que soit la forme', () => withFixture(async ({ run }) => {
  const refused = [
    'SELECT * FROM users',
    'select * from MAIN.users',
    'SELECT * FROM "USERS"',
    'SELECT * FROM [api_keys]',
    'SELECT * FROM `user_credentials`',
    'WITH copie AS (SELECT * FROM users) SELECT * FROM copie',
    'CREATE VIEW vue AS SELECT * FROM vapid_keys',
    "ATTACH DATABASE 'autre.db' AS users",
    'SELECT token FROM piecemaker_telegram_bots',
    'SELECT value FROM app_config',
    'SELECT 1; SELECT password_hash FROM users',
    'SELECT * FROM x.[us"ers]',
  ];
  for (const requete of refused) await assert.rejects(run(requete), /table de secrets/, requete);
  for (const requete of ['SELECT 1 AS piecemaker_users_x', 'SELECT 1 AS users_x', 'SELECT 1 AS xusers', 'SELECT 1 AS "api_keys_copie"']) {
    assert.equal(await run(requete), `${requete.split(' AS ')[1].replace(/"/g, '')}\n1`, requete);
  }
}));

test('remplace par [secret] toute valeur secrète recopiée dans un résultat ou une erreur', () => withFixture(async ({ run }) => {
  assert.equal(await run("SELECT label FROM piecemaker_nodes WHERE id='document:fuite'"), 'label\ncopie [secret] ici');
  await assert.rejects(run(`SELECT no_such_column_${API_KEY.replace(/-/g, '_')} FROM piecemaker_nodes`), (error: Error) => !error.message.includes(API_KEY));
  await assert.rejects(run(`SELECT * FROM nom_${PASSWORD_HASH.replace(/-/g, '_')}`), (error: Error) => !error.message.includes(PASSWORD_HASH));
  assert.equal(await run(`SELECT '${PASSWORD_HASH}' AS cle`), 'cle\n[secret]');
}));

test('les voies de contournement du moteur restent fermées', () => withFixture(async ({ run }) => {
  await assert.rejects(run("SELECT load_extension('inexistant')"));
  await assert.rejects(run('SELECT * FROM sqlite_dbpage'));
  await assert.rejects(run("UPDATE sqlite_master SET name='x' WHERE type='table'"));
}));

test('masque les noms réels du résultat et démasque les codes de la requête', () => withFixture(async ({ run }) => {
  assert.equal(await run(`SELECT label FROM piecemaker_nodes WHERE id='${PERSON}'`), 'label\nPERSONNE_PHYSIQUE_01');
  assert.equal(await run("SELECT id FROM piecemaker_nodes WHERE label='PERSONNE_PHYSIQUE_01'"), `id\n${PERSON}`);
  assert.equal(await run("SELECT id FROM piecemaker_nodes WHERE label='personne_physique_01'"), `id\n${PERSON}`);
  assert.equal(await run("SELECT id FROM piecemaker_nodes WHERE label LIKE '%PERSONNE_MORALE_01%'"), `id\n${COMPANY}`);
  assert.equal(await run("SELECT label FROM piecemaker_nodes WHERE id='entity:PERSONNE_PHYSIQUE_02'"), 'label\nPERSONNE_PHYSIQUE_02');
  assert.equal(await run("SELECT id FROM piecemaker_nodes WHERE label='PERSONNE_PHYSIQUE_02'"), 'id\nentity:PERSONNE_PHYSIQUE_02');
  assert.equal(await run(`SELECT to_node_id FROM piecemaker_links WHERE to_node_id='${PERSON}'`), `to_node_id\n${PERSON}`);
  assert.equal(await run("SELECT node_id FROM piecemaker_mappings WHERE masked_value='PERSONNE_PHYSIQUE_01' AND real_value='Jean Dupont'"), `node_id\n${PERSON}`);
  assert.equal(await run("SELECT json_extract(data_json,'$.code') AS code FROM piecemaker_nodes WHERE json_extract(data_json,'$.code')='PERSONNE_PHYSIQUE_01'"), 'code\nPERSONNE_PHYSIQUE_01');
  assert.equal(await run('SELECT real_value FROM piecemaker_mappings WHERE node_id=\'entity:PERSONNE_PHYSIQUE_01\' ORDER BY real_value'), 'real_value\nPERSONNE_PHYSIQUE_01\nPERSONNE_PHYSIQUE_01');
}));

test('une requête déjà démasquée par le proxy retrouve les mêmes lignes que sa forme codée', () => withFixture(async ({ run }) => {
  assert.equal(await run("SELECT label FROM piecemaker_nodes WHERE id='entity:Jean Dupont'"), 'label\nPERSONNE_PHYSIQUE_01');
  assert.equal(await run("SELECT id FROM piecemaker_nodes WHERE id LIKE 'entity:%Jean D''Arc'"), 'id\nentity:PERSONNE_PHYSIQUE_02');
  assert.equal(await run("SELECT to_node_id FROM piecemaker_links WHERE to_node_id IN ('entity:Jean Dupont','entity:Société Exemple SAS') ORDER BY to_node_id"), `to_node_id\n${COMPANY}\n${PERSON}`);
  assert.equal(await run("SELECT node_id FROM piecemaker_mappings WHERE masked_value='Jean Dupont' AND real_value='Jean Dupont'"), `node_id\n${PERSON}`);
  assert.equal(await run("SELECT node_id FROM piecemaker_mappings WHERE masked_value = 'Jean D''Arc'"), 'node_id\nentity:PERSONNE_PHYSIQUE_02');
  assert.equal(await run("SELECT id FROM piecemaker_nodes WHERE json_extract(data_json,'$.code')='Jean Dupont'"), `id\n${PERSON}`);
}));

test('met en forme la lecture : en-tête, tabulations, NULL écrit ∅, JSON intact', () => withFixture(async ({ run }) => {
  assert.equal(
    await run("SELECT id, doc_date, json_extract(data_json,'$.path') IS NULL AS sans_chemin, data_json FROM piecemaker_nodes WHERE id IN ('document:piece-2') ORDER BY id"),
    'id\tdoc_date\tsans_chemin\tdata_json\ndocument:piece-2\t∅\t1\t{}',
  );
  assert.equal(await run("SELECT id FROM piecemaker_nodes WHERE id='absent'"), 'id');
}));

test('une écriture renvoie le nombre de lignes modifiées', () => withFixture(async ({ run, rows }) => {
  assert.equal(await run("UPDATE piecemaker_nodes SET data_json='{\"nature\":\"courrier\"}' WHERE id='document:piece-2'"), '1 ligne(s) modifiée(s)');
  assert.equal(
    await run("INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'document:a','document','a'); INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'document:b','document','b')"),
    '2 ligne(s) modifiée(s)',
  );
  assert.equal(rows("SELECT COUNT(*) AS n FROM piecemaker_nodes WHERE id IN ('document:a','document:b')")[0].n, 2);
}));

test('une instruction qui échoue annule toute la requête', () => withFixture(async ({ run, rows }) => {
  await assert.rejects(run("INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'document:z','document','z'); INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'document:z','document','doublon')"));
  assert.equal(rows("SELECT COUNT(*) AS n FROM piecemaker_nodes WHERE id='document:z'")[0].n, 0);
}));

test('les dates, search_text et updated_at sont automatiques', () => withFixture(async ({ run, rows, appDb }) => {
  await run("INSERT INTO piecemaker_nodes(project_id,id,kind,label,aliases_json) VALUES(dossier(),'autre:nouveau','other','Éloïse Martin','[\"Ça Va\"]')");
  const inserted = rows("SELECT created_at, updated_at, search_text FROM piecemaker_nodes WHERE id='autre:nouveau'")[0];
  assert.match(String(inserted.created_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(String(inserted.updated_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(inserted.search_text, 'eloise martin\u0000ca va');

  const stale = '2000-01-01T00:00:00.000Z';
  appDb.prepare("UPDATE piecemaker_nodes SET updated_at=? WHERE id='autre:nouveau'").run(stale);
  appDb.prepare('UPDATE piecemaker_links SET updated_at=? WHERE to_node_id=?').run(stale, PERSON);
  await run("UPDATE piecemaker_nodes SET label='Ève Durand' WHERE id='autre:nouveau'");
  const updated = rows("SELECT updated_at, search_text FROM piecemaker_nodes WHERE id='autre:nouveau'")[0];
  assert.notEqual(updated.updated_at, stale);
  assert.equal(updated.search_text, 'eve durand\u0000ca va');
  await run(`UPDATE piecemaker_links SET data_json='{"x":1}' WHERE to_node_id='${PERSON}'`);
  assert.notEqual(rows('SELECT updated_at FROM piecemaker_links WHERE to_node_id=?', PERSON)[0].updated_at, stale);
}));

test('une nouvelle personne reçoit un code, un masque et l\'identifiant entity:CODE', () => withFixture(async ({ run, rows, store }) => {
  const result = await run("INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'manuel:1','person','Marie Curie')");
  assert.match(result, /^1 ligne\(s\) modifiée\(s\)\nnouvel id : manuel:1 → entity:PERSONNE_PHYSIQUE_03$/);
  assert.equal(rows("SELECT COUNT(*) AS n FROM piecemaker_nodes WHERE id='manuel:1'")[0].n, 0);
  assert.deepEqual(rows("SELECT node_id, real_value, masked_value FROM piecemaker_mappings WHERE real_value='Marie Curie'"), [{ node_id: 'entity:PERSONNE_PHYSIQUE_03', real_value: 'Marie Curie', masked_value: 'PERSONNE_PHYSIQUE_03' }]);
  assert.equal(JSON.parse(String(rows("SELECT data_json FROM piecemaker_nodes WHERE id='entity:PERSONNE_PHYSIQUE_03'")[0].data_json)).code, 'PERSONNE_PHYSIQUE_03');
  assert.equal(await run("SELECT label FROM piecemaker_nodes WHERE id='entity:PERSONNE_PHYSIQUE_03'"), 'label\nPERSONNE_PHYSIQUE_03');
  assert.equal(await run("SELECT id FROM piecemaker_nodes WHERE label='Marie Curie'"), 'id\nentity:PERSONNE_PHYSIQUE_03');
  assert.ok(store.snapshot(PROJECT_ONE).nodes.some((node) => node.id === 'entity:PERSONNE_PHYSIQUE_03'));

  const company = await run("INSERT INTO piecemaker_nodes(project_id,id,kind,label,aliases_json) VALUES(dossier(),'manuel:2','company','Atelier Lilas SARL','[\"Atelier Lilas\"]')");
  assert.match(company, /nouvel id : manuel:2 → entity:PERSONNE_MORALE_02$/);
  assert.equal(rows("SELECT COUNT(*) AS n FROM piecemaker_mappings WHERE node_id='entity:PERSONNE_MORALE_02'")[0].n, 2);
}));

test('le résultat d\'une insertion renvoie déjà le nom masqué', () => withFixture(async ({ run }) => {
  const result = await run("INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'manuel:1','person','Marie Curie') RETURNING id, label");
  assert.equal(result, 'id\tlabel\nmanuel:1\tPERSONNE_PHYSIQUE_03\n1 ligne(s) modifiée(s)\nnouvel id : manuel:1 → entity:PERSONNE_PHYSIQUE_03');
}));

test('une entité insérée avec un nom d\'adresse ou une pièce n\'est pas masquée d\'office', () => withFixture(async ({ run, rows }) => {
  const result = await run("INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'manuel:adresse','address','12 rue des Lilas, Paris')");
  assert.equal(result, '1 ligne(s) modifiée(s)');
  assert.equal(rows("SELECT COUNT(*) AS n FROM piecemaker_mappings WHERE node_id='manuel:adresse'")[0].n, 0);
}));

test('supprimer une entité l\'exclut du dossier', () => withFixture(async ({ run, rows, exclusions }) => {
  assert.equal(await run(`DELETE FROM piecemaker_nodes WHERE id='${PERSON}'`), '1 ligne(s) modifiée(s)');
  assert.deepEqual([...exclusions().values].sort(), ['Dupont', 'Jean Dupont']);
  assert.equal(exclusions().liens.length, 0);
  assert.equal(rows("SELECT COUNT(*) AS n FROM piecemaker_mappings WHERE node_id=?", PERSON)[0].n, 0);
}));

test('supprimer une mention l\'exclut pour ce dossier', () => withFixture(async ({ run, exclusions }) => {
  await run(`DELETE FROM piecemaker_links WHERE from_node_id='${PIECE}' AND to_node_id='${PERSON}' AND relation='mentions'`);
  assert.deepEqual(exclusions().liens, [{ piece: PIECE, entite: PERSON, relation: 'mentions' }]);
  assert.deepEqual(exclusions().values, []);
}));

test('une suppression en cascade n\'enregistre pas d\'exclusion de mention', () => withFixture(async ({ run, exclusions }) => {
  await run(`DELETE FROM piecemaker_nodes WHERE id='${PIECE}'`);
  assert.deepEqual(exclusions(), { values: [], liens: [] });
  await run(`DELETE FROM piecemaker_nodes WHERE id='${COMPANY}'`);
  assert.deepEqual(exclusions().liens, []);
  assert.deepEqual([...exclusions().values].sort(), ['Société Exemple', 'Société Exemple SAS']);
}));

test('dossier() sans argument désigne le dossier de la session, sous-dossiers compris', () => withFixture(async ({ run, roots }) => {
  assert.equal(await run('SELECT dossier() AS id', roots.one), `id\n${PROJECT_ONE}`);
  assert.equal(await run('SELECT dossier() AS id', path.join(roots.two, 'sous', 'dossier')), `id\n${PROJECT_TWO}`);
  await assert.rejects(run('SELECT dossier()', os.tmpdir()), { message: 'pas de dossier courant' });
  await assert.rejects(run('SELECT dossier()', path.join(roots.one, '..')), { message: 'pas de dossier courant' });
  await assert.rejects(run('SELECT dossier()', null), { message: 'pas de dossier courant' });
}));

test('dossier() retient le plus long préfixe quand un dossier en contient un autre', () => withFixture(async ({ run, appDb, roots }) => {
  const nested = path.join(roots.one, 'sous');
  appDb.prepare('INSERT INTO projects(project_id, project_path, custom_project_name) VALUES (?, ?, ?)').run('c0ffee00-dddd-4000-8000-000000000004', nested, 'Imbriqué');
  assert.equal(await run('SELECT dossier() AS id', path.join(nested, 'dossier')), 'id\nc0ffee00-dddd-4000-8000-000000000004');
  assert.equal(await run('SELECT dossier() AS id', path.join(roots.one, 'autre')), `id\n${PROJECT_ONE}`);
}));

test('dossier(x) accepte un préfixe d\'identifiant, un nom, un code masqué', () => withFixture(async ({ run }) => {
  assert.equal(await run("SELECT dossier('3f2a9c') AS id"), `id\n${PROJECT_TWO}`);
  assert.equal(await run("SELECT dossier('3F2A9C11-bb') AS id"), `id\n${PROJECT_TWO}`);
  assert.equal(await run("SELECT dossier('Exemple') AS id"), `id\n${PROJECT_TWO}`);
  assert.equal(await run("SELECT dossier('societe EXEMPLE') AS id"), `id\n${PROJECT_TWO}`);
  assert.equal(await run("SELECT dossier('bis') AS id"), `id\n${PROJECT_THREE}`);
  assert.equal(await run("SELECT dossier('PERSONNE_MORALE_01') AS id"), `id\n${PROJECT_TWO}`);
  assert.equal(await run("SELECT dossier('Société Exemple SAS') AS id"), `id\n${PROJECT_TWO}`);
  assert.equal(await run("SELECT COUNT(*) AS n FROM piecemaker_nodes WHERE project_id=dossier('3f2a9c')"), 'n\n0');
  assert.equal(await run("SELECT COUNT(*) AS n FROM piecemaker_nodes WHERE project_id=dossier()"), 'n\n6');
}));

test('dossier() signale un nom ambigu sur une ligne, masqué, cinq candidats au plus', () => withFixture(async ({ run, appDb, directory }) => {
  await assert.rejects(run("SELECT dossier('Dupont')"), (error: Error) => {
    assert.match(error.message, /^ambigu : [0-9a-f]{6} .+ ; [0-9a-f]{6} .+$/);
    assert.ok(!error.message.includes('\n'));
    assert.ok(!error.message.includes('Dupont'));
    assert.match(error.message, /PERSONNE_PHYSIQUE_01/);
    return true;
  });
  for (let index = 0; index < 7; index += 1) {
    appDb.prepare('INSERT INTO projects(project_id, project_path, custom_project_name) VALUES (?, ?, ?)').run(`d${index}00000-eeee-4000-8000-00000000000${index}`, path.join(directory, `lot-${index}`), `Lot Test ${index}`);
  }
  await assert.rejects(run("SELECT dossier('Lot Test')"), (error: Error) => {
    assert.equal(error.message.split(' ; ').length, 5);
    assert.ok(!error.message.includes('\n'));
    return true;
  });
  await assert.rejects(run("SELECT dossier('d9999')"), { message: 'aucun dossier' });
}));

test('dossier() ne trouve rien pour un nom inconnu', () => withFixture(async ({ run }) => {
  await assert.rejects(run("SELECT dossier('Inconnu')"), { message: 'aucun dossier' });
  await assert.rejects(run("SELECT dossier('')"), { message: 'aucun dossier' });
}));

test('renommer une pièce par UPDATE du libellé renomme le fichier et renvoie le nouvel identifiant', () => withFixture(async ({ run, rows, store, calls, setRenamer, roots }) => {
  setRenamer(async (projectId, piecePath, name) => {
    const previous = path.relative(roots.one, piecePath);
    const current = `${name}${path.extname(previous)}`;
    const node = store.snapshot(projectId).nodes.find((candidate) => candidate.id === PIECE);
    store.update({ projectId, operations: [
      { op: 'renameNode', rename: { fromNodeId: PIECE, toNodeId: 'document:piece-renommee' } },
      { op: 'upsertNode', node: { id: 'document:piece-renommee', kind: 'document', label: current, aliases: node?.aliases ?? [], data: { ...(node?.data ?? {}), path: path.join(roots.one, current) } } },
    ] });
    return { previous, current };
  });
  const result = await run("UPDATE piecemaker_nodes SET label='2024-02-10_Facture client.pdf' WHERE id='document:piece-1'");
  assert.equal(result, '1 ligne(s) modifiée(s)\nnouvel id : document:piece-1 → document:piece-renommee');
  assert.deepEqual(calls, [[PROJECT_ONE, path.join(roots.one, '2024-01-09_Facture.pdf'), '2024-02-10_Facture client']]);
  assert.equal(rows("SELECT COUNT(*) AS n FROM piecemaker_nodes WHERE id='document:piece-1'")[0].n, 0);
  assert.equal(rows("SELECT label FROM piecemaker_nodes WHERE id='document:piece-renommee'")[0].label, '2024-02-10_Facture client.pdf');
  assert.equal(rows("SELECT COUNT(*) AS n FROM piecemaker_links WHERE from_node_id='document:piece-renommee'")[0].n, 2);
}));

test('un renommage refusé restaure le libellé et renvoie l\'erreur', () => withFixture(async ({ run, rows, calls, setRenamer }) => {
  setRenamer(async () => { throw new TypeError('Le nom doit commencer par une date AAAA-MM-JJ, suivie de « _ » et du titre de la pièce.'); });
  await assert.rejects(run("UPDATE piecemaker_nodes SET label='sans date' WHERE id='document:piece-1'"), (error: Error) => {
    assert.match(error.message, /renommage refusé, libellé restauré \(2024-01-09_Facture\.pdf\) : Le nom doit commencer par une date/);
    assert.match(error.message, /^1 ligne\(s\) modifiée\(s\)/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(rows("SELECT label FROM piecemaker_nodes WHERE id='document:piece-1'")[0].label, '2024-01-09_Facture.pdf');
  setRenamer(async () => { throw new Error('Une conversion est en cours sur ce dossier.'); });
  await assert.rejects(run("UPDATE piecemaker_nodes SET label='2024-03-01_Autre' WHERE id='document:piece-1'"), /Une conversion est en cours/);
  assert.equal(rows("SELECT label FROM piecemaker_nodes WHERE id='document:piece-1'")[0].label, '2024-01-09_Facture.pdf');
}));

test('changer le libellé d\'une entité ou d\'une pièce sans chemin ne lance aucun renommage', () => withFixture(async ({ run, calls }) => {
  await run(`UPDATE piecemaker_nodes SET label='Jean Durand' WHERE id='${PERSON}'`);
  assert.equal(calls.length, 0);
  await assert.rejects(run("UPDATE piecemaker_nodes SET label='2024-03-01_Autre' WHERE id='document:piece-2'"), /pièce sans chemin enregistré/);
}));

test('la sauvegarde hebdomadaire n\'est faite qu\'à la première écriture de la semaine et garde les quatre dernières', () => withFixture(async ({ run, directory, setNow }) => {
  const backups = () => fs.readdirSync(path.join(directory, 'backups')).filter((name) => name.endsWith('.db')).sort();
  await run("SELECT 1");
  assert.equal(fs.existsSync(path.join(directory, 'backups')), false);
  await run("UPDATE piecemaker_nodes SET data_json='{}' WHERE id='document:piece-2'");
  assert.deepEqual(backups(), ['auth-2026-S41.db']);
  const first = fs.statSync(path.join(directory, 'backups', 'auth-2026-S41.db')).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await run("INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'document:ajout','document','ajout')");
  assert.deepEqual(backups(), ['auth-2026-S41.db']);
  assert.equal(fs.statSync(path.join(directory, 'backups', 'auth-2026-S41.db')).mtimeMs, first);
  const copy = new Database(path.join(directory, 'backups', 'auth-2026-S41.db'), { readonly: true });
  assert.equal((copy.prepare("SELECT COUNT(*) AS n FROM piecemaker_nodes WHERE id='document:ajout'").get() as { n: number }).n, 0);
  assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM piecemaker_nodes').get() as { n: number }).n, 6);
  copy.close();
  for (const week of ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']) {
    setNow(new Date(`${week}T10:00:00Z`));
    await run("UPDATE piecemaker_nodes SET data_json='{}' WHERE id='document:piece-2'");
  }
  assert.deepEqual(backups(), ['auth-2026-S43.db', 'auth-2026-S44.db', 'auth-2026-S45.db', 'auth-2026-S46.db']);
}));

test('aucun trigger ni table temporaire n\'est écrit dans la base', () => withFixture(async ({ run, appDb, tool, directory }) => {
  await run("INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES(dossier(),'manuel:1','person','Marie Curie')");
  const before = appDb.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'pm_%' OR name IN ('renommages','nouvelles_entites','entites_supprimees','mentions_supprimees')").all();
  assert.deepEqual(before, []);
  tool.close();
  const reopened = new Database(path.join(directory, 'auth.db'), { readonly: true });
  assert.deepEqual(reopened.prepare("SELECT name FROM sqlite_master WHERE type='trigger' OR name IN ('renommages','nouvelles_entites','entites_supprimees','mentions_supprimees')").all(), []);
  reopened.close();
}));

test('les instructions de transaction explicites sont refusées', () => withFixture(async ({ run, rows }) => {
  for (const requete of ['BEGIN', 'begin immediate', 'COMMIT', 'ROLLBACK', 'SAVEPOINT a', 'END', "DELETE FROM piecemaker_nodes WHERE id='x'; COMMIT", '/* note */ BEGIN TRANSACTION; SELECT 1; COMMIT']) {
    await assert.rejects(run(requete), /BEGIN, COMMIT, ROLLBACK et SAVEPOINT refusés/, requete);
  }
  assert.equal(await run("SELECT CASE WHEN 1=1 THEN 'oui' END AS reponse"), 'reponse\noui');
  assert.equal(rows('SELECT COUNT(*) AS n FROM piecemaker_nodes')[0].n, 6);
}));

test('refuse une requête vide et relaie les erreurs SQL sans noms réels', () => withFixture(async ({ run }) => {
  await assert.rejects(run('   '), { message: 'requête vide' });
  await assert.rejects(run("SELECT * FROM piecemaker_nodes WHERE label = 'PERSONNE_PHYSIQUE_01' AND colonne_inconnue = 1"), (error: Error) => /colonne_inconnue/.test(error.message) && !error.message.includes('Jean Dupont'));
}));
