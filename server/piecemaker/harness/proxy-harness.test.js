/**
 * Câblage du harnais de citations vérifiées sur le proxy PII — bout en bout,
 * contre un faux amont, comme `../anonymizer/anonymizer.test.js`.
 *
 * Ce que ces tests vérifient, au-delà de ce que couvre déjà `harness.test.js`
 * (la logique du harnais isolée) : que le proxy observe le bon texte au bon
 * moment (corps brut du client à l'aller, texte livré au client au retour,
 * y compris sur le chemin `current.empty`), et que rien de tout cela ne peut
 * jamais dégrader ni retarder ce qui est réellement délivré au client — même
 * quand le harnais fourni est défaillant.
 *
 * Le mapping utilisé est fictif et créé dans un dossier temporaire ; il n'a
 * aucun rapport avec le mapping central de la machine, pas plus que le
 * `homeDir` du harnais (décisions, journal de vérification).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDictionaryLoader } = require('../anonymizer/dictionary.cjs');
const { createAnonymizerProxy } = require('../anonymizer/proxy.cjs');
const { createHarnessJuridique } = require('./index.cjs');

const CODE = 'PERSONNE_PHYSIQUE_01';
const NAME = 'Jean Dupont';

const DECISION_ID = 'JURITEXT000099990001';
const TEXTE_COMPLET = [
  'Cour de cassation, arrêt du 12 janvier 2024',
  '',
  '=================================',
  'TEXTE INTÉGRAL:',
  '=================================',
  '',
  "Attendu que le salarié a été licencié sans cause réelle et sérieuse ;",
  '',
  `Lien: https://www.legifrance.gouv.fr/juri/id/${DECISION_ID}`,
].join('\n');

/** Requête Anthropic Messages portant un aller-retour `consulter_decision`. */
function decisionRequestBody({ stream = true } = {}) {
  return JSON.stringify({
    stream,
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'mcp__legifrance__consulter_decision', input: { text_id: DECISION_ID } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: TEXTE_COMPLET }] }],
      },
    ],
  });
}

function makeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-proxyharness-'));
  fs.writeFileSync(path.join(dir, 'central-mapping.json'), JSON.stringify({
    version: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    mapping: { [NAME]: CODE },
    reverse_mapping: { [CODE]: [NAME] },
  }));
  return dir;
}

function makeEmptyHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-proxyharness-vide-'));
}

/** Faux amont : renvoie ce qu'il a reçu, plus une réponse du type demandé. */
function startUpstream(respond) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ url: req.url, body: Buffer.concat(chunks).toString('utf8') });
      respond(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ seen, server, port: server.address().port }));
  });
}

async function withProxy(homeDir, respond, run, { harness = null } = {}) {
  const upstream = await startUpstream(respond);
  const proxy = createAnonymizerProxy({
    dictionary: createDictionaryLoader({ homeDir }),
    port: 0,
    routes: [{ provider: 'claude', prefix: '/anthropic', upstream: `http://127.0.0.1:${upstream.port}` }],
    harness,
  });
  const { origin } = await proxy.listen();
  try {
    return await run({ origin, seen: upstream.seen });
  } finally {
    await proxy.close();
    await new Promise((resolve) => upstream.server.close(resolve));
  }
}

function post(origin, body, route = '/anthropic/v1/messages') {
  return new Promise((resolve, reject) => {
    const request = http.request(`${origin}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve(text));
    });
    request.on('error', reject);
    request.end(body);
  });
}

/** Écrit un événement `content_block_delta` Anthropic portant du texte visible. */
function sseDelta(text) {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text },
  })}\n\n`;
}

/** Réponse SSE Anthropic minimale portant les fragments de texte donnés. */
function respondSse(res, fragments) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const text of fragments) res.write(sseDelta(text));
  res.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
  res.end();
}

/** Attend qu'un prédicat devienne vrai — pour l'écriture asynchrone, fire-and-forget, du harnais. */
async function waitFor(predicate, { timeout = 2000, interval = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return predicate();
}

const CITATIONS_LOG = (homeDir) => path.join(homeDir, 'citations-verifiees.jsonl');
const DECISION_FILE = (homeDir) => path.join(homeDir, 'decisions', `${DECISION_ID}.json`);

test('une décision consulter_decision dans une requête Anthropic streamée est capturée', async () => {
  const homeDir = makeHome();
  const harness = createHarnessJuridique({ homeDir });

  await withProxy(homeDir, (res) => respondSse(res, ['Bonjour.']), ({ origin }) => post(origin, decisionRequestBody()), { harness });

  assert.equal(fs.existsSync(DECISION_FILE(homeDir)), true, 'la décision consultée n’a pas été mise en cache');
  const cached = JSON.parse(fs.readFileSync(DECISION_FILE(homeDir), 'utf8'));
  assert.equal(cached.id, DECISION_ID);
});

test('une réponse SSE portant un bloc <CITATIONS> est journalisée', async () => {
  const homeDir = makeHome();
  const harness = createHarnessJuridique({ homeDir });
  const fragments = ['Analyse.\n', '<CITATIONS>[{"ref":1,"doc_id":"piece1.md","page":1,"quote":"une phrase"}]</CITATIONS>'];

  await withProxy(homeDir, (res) => respondSse(res, fragments), ({ origin }) => post(origin, JSON.stringify({ stream: true, messages: [] })), { harness });

  const written = await waitFor(() => fs.existsSync(CITATIONS_LOG(homeDir)));
  assert.equal(written, true, 'le journal de vérification n’a jamais été écrit');
  const line = JSON.parse(fs.readFileSync(CITATIONS_LOG(homeDir), 'utf8').trim().split('\n')[0]);
  assert.equal(line.citations, 1);
});

test('même cas avec un mapping vide (chemin current.empty) : la journalisation fonctionne aussi', async () => {
  const homeDir = makeEmptyHome();
  const harness = createHarnessJuridique({ homeDir });
  const fragments = ['Analyse.\n', '<CITATIONS>[{"ref":1,"doc_id":"piece1.md","page":1,"quote":"une phrase"}]</CITATIONS>'];

  await withProxy(homeDir, (res) => respondSse(res, fragments), ({ origin }) => post(origin, JSON.stringify({ stream: true, messages: [] })), { harness });

  const written = await waitFor(() => fs.existsSync(CITATIONS_LOG(homeDir)));
  assert.equal(written, true, 'le chemin current.empty n’observe pas la réponse');
});

test('une réponse SSE sans bloc <CITATIONS> n’écrit rien', async () => {
  const homeDir = makeHome();
  const harness = createHarnessJuridique({ homeDir });

  await withProxy(homeDir, (res) => respondSse(res, ['Réponse ordinaire, sans citations structurées.']), ({ origin }) => post(origin, JSON.stringify({ stream: true, messages: [] })), { harness });

  // Le harnais est fire-and-forget : une courte attente laisse le temps à une
  // écriture éventuelle de se produire avant de constater son absence.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.existsSync(CITATIONS_LOG(homeDir)), false, 'un journal a été écrit alors qu’aucune citation n’était présente');
});

test('la présence du harnais ne modifie jamais ce qui est livré au client', async () => {
  const fragments = ['Le client ', 'PERSONNE_', 'PHYSIQUE', '_01', ' a signé.\n', '<CITATIONS>[{"ref":1,"doc_id":"piece1.md","page":1,"quote":"peu importe"}]</CITATIONS>'];
  const homeSansHarnais = makeHome();
  const homeAvecHarnais = makeHome();

  const sansHarnais = await withProxy(homeSansHarnais, (res) => respondSse(res, fragments), ({ origin }) => post(origin, JSON.stringify({ stream: true, messages: [] })));
  const avecHarnais = await withProxy(homeAvecHarnais, (res) => respondSse(res, fragments), ({ origin }) => post(origin, JSON.stringify({ stream: true, messages: [] })), { harness: createHarnessJuridique({ homeDir: homeAvecHarnais }) });

  assert.equal(avecHarnais, sansHarnais, 'la sortie livrée au client diffère selon la présence du harnais');
});

test('une erreur du harnais ne casse ni la requête ni la réponse', async () => {
  const homeDir = makeHome();
  const fakeHarness = {
    observerRequete() { throw new Error('harnais défaillant (requête)'); },
    observerReponse() { throw new Error('harnais défaillant (réponse)'); },
  };
  const json = { content: [{ type: 'text', text: `Réponse sur ${CODE}.` }] };

  const answer = await withProxy(homeDir, (res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  }, ({ origin }) => post(origin, JSON.stringify({ messages: [{ role: 'user', content: `Analyse le dossier de ${NAME}.` }] })), { harness: fakeHarness });

  assert.ok(answer.includes(NAME), 'la réponse n’a pas été dé-anonymisée malgré l’erreur du harnais');
});
