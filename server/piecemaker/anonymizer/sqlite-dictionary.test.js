import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const { anonymize, deanonymize } = require('./dictionary.cjs');
const { createSqliteDictionaryLoader } = require('./sqlite-dictionary.cjs');

function databaseFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-sqlite-dictionary-'));
  const file = path.join(directory, 'auth.db');
  const database = new Database(file);
  database.exec(`
    CREATE TABLE piecemaker_nodes (project_id TEXT, id TEXT, label TEXT, PRIMARY KEY (project_id,id));
    CREATE TABLE piecemaker_mappings (project_id TEXT,node_id TEXT,real_value TEXT,masked_value TEXT,updated_at TEXT);
  `);
  return { database, file };
}

function insertMapping(database, projectId, nodeId, real, masked, updatedAt = '2026-09-15T10:00:00.000Z') {
  database.prepare('INSERT OR IGNORE INTO piecemaker_nodes(project_id,id,label) VALUES(?,?,?)').run(projectId, nodeId, real);
  database.prepare('INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,updated_at) VALUES(?,?,?,?,?)').run(projectId, nodeId, real, masked, updatedAt);
}

test('le dictionnaire du hook lit et recharge les mappings SQLite', () => {
  const { database, file } = databaseFixture();
  insertMapping(database, 'dossier-1', 'personne-1', 'Mme Dupont', 'PERSONNE_PHYSIQUE_01');
  const loader = createSqliteDictionaryLoader({ databasePath: file });
  assert.equal(anonymize('Dossier de Mme Dupont', loader.get()), 'Dossier de PERSONNE_PHYSIQUE_01');
  assert.equal(deanonymize('Bonjour PERSONNE_PHYSIQUE_01', loader.get()), 'Bonjour Mme Dupont');
  insertMapping(database, 'dossier-1', 'iban-1', 'FR761234', 'IBAN_01', '2026-09-15T10:00:01.000Z');
  assert.equal(anonymize('Compte FR761234', loader.get()), 'Compte IBAN_01');
  loader.close();
  database.close();
});

test('une table absente produit un dictionnaire vide', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-sqlite-dictionary-empty-'));
  const file = path.join(directory, 'auth.db');
  new Database(file).close();
  const loader = createSqliteDictionaryLoader({ databasePath: file });
  assert.equal(loader.get().empty, true);
  loader.close();
});

test('une base présente mais illisible bloque l’envoi au lieu de laisser passer en clair', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-sqlite-dictionary-corrupt-'));
  const file = path.join(directory, 'auth.db');
  fs.writeFileSync(file, 'pas une base SQLite'.repeat(100));
  const loader = createSqliteDictionaryLoader({ databasePath: file });
  assert.throws(() => loader.getForOutbound(), /dictionnaire illisible/);
  loader.close();
});

test('une base absente reste un dictionnaire vide utilisable à l’envoi', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-sqlite-dictionary-missing-'));
  const loader = createSqliteDictionaryLoader({ databasePath: path.join(directory, 'auth.db') });
  assert.equal(loader.getForOutbound().empty, true);
  loader.close();
});
