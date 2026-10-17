import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';

const require = createRequire(import.meta.url);
const { anonymize, buildDictionary, deanonymize, resolveContext } = require('./dictionary.cjs');
const { buildMappingDocument, createSqliteDictionaryLoader } = require('./sqlite-dictionary.cjs');
const { createSseRewriter, rewriteJsonBody } = require('./rewrite.cjs');
const { startRewriterBridge } = require('./rewriter-bridge.cjs');

const TOKEN = 'jeton-de-test';

function temporaryDirectory(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `piecemaker-${name}-`));
}

function twoCaseDatabase(): string {
  const file = path.join(temporaryDirectory('codes-globaux'), 'auth.db');
  const database = new Database(file);
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.prepare('INSERT INTO projects VALUES (?, ?)').run('dossier-ancien', '/cases/ancien');
  database.prepare('INSERT INTO projects VALUES (?, ?)').run('dossier-recent', '/cases/recent');
  database.close();
  new KnowledgeStore(file).close();
  return file;
}

function insertPerson(file: string, projectId: string, code: string, real: string, createdAt: string): void {
  const database = new Database(file);
  database.prepare('INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(projectId, `entity:${code}`, 'person', real, real.toLowerCase(), '[]', JSON.stringify({ code }), createdAt, createdAt);
  database.prepare('INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(projectId, `entity:${code}`, real, code, real.toLowerCase(), '{}', createdAt, createdAt);
  database.close();
}

type Row = { project_id: string; node_id: string; real_value: string; masked_value: string; updated_at: string; label: string };

function rows(entries: Array<[string, string, string, string[]]>): Row[] {
  return entries.flatMap(([projectId, code, label, variants]) => [label, ...variants].map((real) => ({
    project_id: projectId,
    node_id: `entity:${code}`,
    real_value: real,
    masked_value: code,
    updated_at: '2026-10-01T00:00:00.000Z',
    label,
  })));
}

function sseText(output: string): string {
  return output.split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((event) => event.type === 'content_block_delta')
    .map((event) => event.delta.text)
    .join('');
}

function streamThrough(fragments: string[], transform: (text: string) => string): string {
  const rewriter = createSseRewriter(transform);
  let output = '';
  for (const text of fragments) {
    output += rewriter.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`);
  }
  output += rewriter.push('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
  return output + rewriter.end();
}

test('deux dossiers avec chacun un PERSONNE_PHYSIQUE_01 : collision avant migration, plus aucune après', () => {
  const file = twoCaseDatabase();
  insertPerson(file, 'dossier-ancien', 'PERSONNE_PHYSIQUE_01', 'Jean Dupont', '2026-01-01T00:00:00.000Z');
  insertPerson(file, 'dossier-recent', 'PERSONNE_PHYSIQUE_01', 'Marie Durand', '2026-06-01T00:00:00.000Z');

  const loader = createSqliteDictionaryLoader({ databasePath: file });
  const before = loader.get();
  assert.equal(anonymize('Jean Dupont', before), 'PERSONNE_PHYSIQUE_01');
  assert.equal(anonymize('Marie Durand', before), 'PERSONNE_PHYSIQUE_01');
  assert.equal(deanonymize('PERSONNE_PHYSIQUE_01', before), 'Marie Durand');

  new KnowledgeStore(file).close();
  const after = loader.refresh();
  assert.equal(anonymize('Jean Dupont', after), 'PERSONNE_PHYSIQUE_01');
  assert.equal(anonymize('Marie Durand', after), 'PERSONNE_PHYSIQUE_02');
  assert.equal(deanonymize('PERSONNE_PHYSIQUE_01 et PERSONNE_PHYSIQUE_02', after), 'Jean Dupont et Marie Durand');
  assert.equal(deanonymize('PERSONNE_PHYSIQUE_01', after, { projectId: 'dossier-recent' }), 'Marie Durand');
  assert.equal(deanonymize('PERSONNE_PHYSIQUE_01', after, { projectId: 'dossier-ancien' }), 'Jean Dupont');
  loader.close();
});

test('codes à cinq chiffres et plus : masquage, ré-identification JSON et SSE découpé, sans préfixe avalé', () => {
  const filler = Array.from({ length: 3000 }, (_, index): [string, string, string, string[]] => {
    const letters = index.toString(26).split('').map((digit) => String.fromCharCode(97 + parseInt(digit, 26))).join('');
    return ['dossier-volume', `PERSONNE_PHYSIQUE_${20000 + index}`, `Témoin Fictif ${letters}`, []];
  });
  const dictionary = buildDictionary(buildMappingDocument(rows([
    ['dossier-volume', 'PERSONNE_PHYSIQUE_1', 'Alice Exemple', []],
    ['dossier-volume', 'PERSONNE_PHYSIQUE_12345', 'Bruno Fictif', ['M. Fictif']],
    ['dossier-volume', 'PERSONNE_PHYSIQUE_123456', 'Chloé Inventée', []],
    ...filler,
  ])), 1);

  const request = JSON.stringify({ messages: [{ role: 'user', content: 'Alice Exemple, Bruno Fictif, M. Fictif, Chloé Inventée et Témoin Fictif baa.' }] });
  const sent = rewriteJsonBody(request, (text: string) => anonymize(text, dictionary));
  assert.equal(JSON.parse(sent).messages[0].content, 'PERSONNE_PHYSIQUE_1, PERSONNE_PHYSIQUE_12345, PERSONNE_PHYSIQUE_12345, PERSONNE_PHYSIQUE_123456 et PERSONNE_PHYSIQUE_20676.');

  const reply = JSON.stringify({ content: [{ type: 'text', text: 'PERSONNE_PHYSIQUE_12345, PERSONNE_PHYSIQUE_1, PERSONNE_PHYSIQUE_123456, PERSONNE_PHYSIQUE_12 et PERSONNE_PHYSIQUE_1234567.' }] });
  const back = rewriteJsonBody(reply, (text: string) => deanonymize(text, dictionary));
  assert.equal(JSON.parse(back).content[0].text, 'Bruno Fictif, Alice Exemple, Chloé Inventée, PERSONNE_PHYSIQUE_12 et PERSONNE_PHYSIQUE_1234567.');

  const transform = (text: string) => deanonymize(text, dictionary);
  assert.equal(sseText(streamThrough(['Vu ', 'PERSONNE_PHYSIQUE_1', '2345', ' puis PERSONNE_', 'PHYSIQUE_1', ' et PERSONNE_PHYSIQUE_12345', '6.'], transform)), 'Vu Bruno Fictif puis Alice Exemple et Chloé Inventée.');
  const sentence = 'PERSONNE_PHYSIQUE_12345 signe.';
  for (let cut = 1; cut < sentence.length; cut += 1) {
    assert.equal(sseText(streamThrough([sentence.slice(0, cut), sentence.slice(cut)], transform)), 'Bruno Fictif signe.');
  }
});

const SHARED = rows([
  ['dossier-a', 'PERSONNE_PHYSIQUE_10', 'Paul Exemplon', ['Exemplon']],
  ['dossier-a', 'SAS_40', 'Garage Modèle', []],
  ['dossier-b', 'PERSONNE_PHYSIQUE_20', 'Anne Exemplon', ['Exemplon']],
  ['dossier-b', 'SAS_30', 'Société Témoin', []],
]);

test('une variante partagée entre deux dossiers suit le dossier de la session, puis le contexte', () => {
  const dictionary = buildDictionary(buildMappingDocument(SHARED), 1);
  const code = (text: string, projectId: string | null) => anonymize(text, dictionary, resolveContext(dictionary, { projectId, text }));

  assert.equal(code('Courrier de Exemplon', 'dossier-a'), 'Courrier de PERSONNE_PHYSIQUE_10');
  assert.equal(code('Courrier de Exemplon', 'dossier-b'), 'Courrier de PERSONNE_PHYSIQUE_20');
  assert.equal(code('Société Témoin écrit à Exemplon', null), 'SAS_30 écrit à PERSONNE_PHYSIQUE_20');
  assert.equal(code('Garage Modèle écrit à Exemplon', null), 'SAS_40 écrit à PERSONNE_PHYSIQUE_10');
  assert.equal(code('SAS_30 a répondu à Exemplon', null), 'SAS_30 a répondu à PERSONNE_PHYSIQUE_20');
  assert.equal(code('Société Témoin écrit à Exemplon', 'dossier-a'), 'SAS_30 écrit à PERSONNE_PHYSIQUE_10');
  assert.equal(code('Paul Exemplon et Anne Exemplon', 'dossier-a'), 'PERSONNE_PHYSIQUE_10 et PERSONNE_PHYSIQUE_20');
  assert.equal(deanonymize('PERSONNE_PHYSIQUE_20 a signé', dictionary, { projectId: 'dossier-a' }), 'Anne Exemplon a signé');
});

test('une variante partagée par deux personnes du même dossier suit celle déjà présente dans la requête', () => {
  const dictionary = buildDictionary(buildMappingDocument(rows([
    ['dossier-a', 'PERSONNE_PHYSIQUE_10', 'Paul Exemplon', ['Exemplon']],
    ['dossier-a', 'PERSONNE_PHYSIQUE_20', 'Anne Exemplon', ['Exemplon']],
  ])), 1);
  const text = 'PERSONNE_PHYSIQUE_20 a écrit. Réponse de Exemplon.';
  assert.equal(anonymize(text, dictionary, resolveContext(dictionary, { projectId: 'dossier-a', text })), 'PERSONNE_PHYSIQUE_20 a écrit. Réponse de PERSONNE_PHYSIQUE_20.');
});

function post(port: number, route: string, body: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error', reject);
    request.end(body);
  });
}

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

test('le réécrivain lit le dossier de la session dans les identifiants du proxy et ignore un jeton faux', async () => {
  const dictionary = buildDictionary(buildMappingDocument(SHARED), 1);
  const bridge = await startRewriterBridge({ dictionary: { get: () => dictionary }, token: TOKEN });
  try {
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'Courrier de Exemplon' }] });
    const content = async (headers: Record<string, string>) => JSON.parse(await post(bridge.port, '/v1/request', body, headers)).messages[0].content;
    assert.equal(await content({ 'x-piecemaker-proxy-authorization': basic('dossier-b', TOKEN) }), 'Courrier de PERSONNE_PHYSIQUE_20');
    assert.equal(await content({ 'x-piecemaker-proxy-authorization': basic('dossier-a', TOKEN) }), 'Courrier de PERSONNE_PHYSIQUE_10');
    assert.equal(await content({ 'x-piecemaker-proxy-authorization': basic('dossier-b', 'faux') }), 'Courrier de PERSONNE_PHYSIQUE_10');
    assert.equal(await content({}), 'Courrier de PERSONNE_PHYSIQUE_10');
  } finally {
    await bridge.close();
  }
});

test('dans une session du dossier renuméroté, l’ancien code revient vers sa propre personne, y compris en SSE', async () => {
  const file = twoCaseDatabase();
  insertPerson(file, 'dossier-ancien', 'PERSONNE_PHYSIQUE_01', 'Jean Dupont', '2026-01-01T00:00:00.000Z');
  insertPerson(file, 'dossier-recent', 'PERSONNE_PHYSIQUE_01', 'Marie Durand', '2026-06-01T00:00:00.000Z');
  new KnowledgeStore(file).close();
  const loader = createSqliteDictionaryLoader({ databasePath: file });
  const bridge = await startRewriterBridge({ dictionary: loader, token: TOKEN });
  try {
    const events = ['Signé par PERSONNE_', 'PHYSIQUE_01.'].map((text) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`).join('')
      + 'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n';
    assert.equal(sseText(await post(bridge.port, '/v1/sse', events, { 'x-piecemaker-proxy-authorization': basic('dossier-recent', TOKEN) })), 'Signé par Marie Durand.');
    assert.equal(sseText(await post(bridge.port, '/v1/sse', events, {})), 'Signé par Jean Dupont.');
    const reply = JSON.stringify({ content: [{ type: 'text', text: 'PERSONNE_PHYSIQUE_01' }] });
    assert.equal(JSON.parse(await post(bridge.port, '/v1/response', reply, { 'x-piecemaker-proxy-authorization': basic('dossier-recent', TOKEN) })).content[0].text, 'Marie Durand');
  } finally {
    await bridge.close();
    loader.close();
  }
});

test('au-delà de 6 400 codes, le masquage des codes déjà présents ne touche aucun autre caractère', () => {
  const entries = Array.from({ length: 7000 }, (_, index): [string, string, string, string[]] => ['dossier-volume', `PERSONNE_PHYSIQUE_${100000 + index}`, `Partie Fictive ${index.toString(36)}x`, []]);
  const dictionary = buildDictionary(buildMappingDocument(rows(entries)), 1);
  const symbols = Array.from({ length: 0x200 }, (_, offset) => String.fromCharCode(0xF900 + offset)).join('');
  const codes = entries.slice(-300).map(([, code]) => code).join(' ');
  const text = `${codes} ${symbols} Partie Fictive 0x`;
  assert.equal(anonymize(text, dictionary), `${codes} ${symbols} PERSONNE_PHYSIQUE_100000`);
});
