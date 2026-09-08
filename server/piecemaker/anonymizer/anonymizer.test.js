/**
 * Bout en bout du proxy PII, contre un faux amont : un nom réel ne doit jamais
 * franchir la frontière réseau, et une réponse codée doit revenir en clair —
 * y compris quand le code arrive découpé sur plusieurs événements SSE.
 *
 * Le mapping utilisé est fictif et créé dans un dossier temporaire ; il n'a
 * aucun rapport avec le mapping central de la machine.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { anonymize, createDictionaryLoader, deanonymize } = require('./dictionary.cjs');
const { createAnonymizerProxy } = require('./proxy.cjs');
const { bypassOpencode, configureOpencode, installCursorGuard } = require('./providers.cjs');
const { createSseRewriter, heldLength, rewriteJsonBody } = require('./rewrite.cjs');
const { resolveUpstream, summarizeCoverage } = require('./service.cjs');

const CODE = 'PERSONNE_PHYSIQUE_01';
const NAME = 'Jean Dupont';

function makeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-anon-'));
  fs.writeFileSync(path.join(dir, 'central-mapping.json'), JSON.stringify({
    version: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    mapping: { [NAME]: CODE },
    reverse_mapping: { [CODE]: [NAME] },
  }));
  return dir;
}

/** Faux amont : renvoie ce qu'il a reçu, plus une réponse codée du type demandé. */
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

async function withProxy(homeDir, respond, run) {
  const upstream = await startUpstream(respond);
  const proxy = createAnonymizerProxy({
    dictionary: createDictionaryLoader({ homeDir }),
    // Port éphémère : un test ne doit pas dépendre d'un port fixe libre.
    port: 0,
    routes: [
      { provider: 'claude', prefix: '/anthropic', upstream: `http://127.0.0.1:${upstream.port}` },
      { provider: 'codex', prefix: '/chatgpt', upstream: `http://127.0.0.1:${upstream.port}` },
      { provider: 'opencode', prefix: '/openai', upstream: `http://127.0.0.1:${upstream.port}` },
    ],
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

/** Rend le texte reconstitué par un client, qui concatène les fragments dans l'ordre. */
function concatDeltas(answer, field) {
  const pattern = new RegExp(`"${field}":("(?:[^"\\\\]|\\\\.)*")`, 'g');
  return [...answer.matchAll(pattern)].map((match) => JSON.parse(match[1])).join('');
}

test('le nom réel ne franchit pas la frontière réseau', async () => {
  const homeDir = makeHome();
  const json = { content: [{ type: 'text', text: `Réponse sur ${CODE}.` }] };
  const answer = await withProxy(homeDir, (res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  }, async ({ origin, seen }) => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: `Analyse le contrat de ${NAME}.` }] });
    const received = await post(origin, body);
    assert.equal(seen.length, 1);
    assert.ok(!seen[0].body.includes(NAME), 'le nom réel a fuité vers l’amont');
    assert.ok(seen[0].body.includes(CODE), 'le code n’a pas été substitué');
    return received;
  });
  assert.ok(answer.includes(NAME), 'la réponse n’a pas été dé-anonymisée');
  assert.ok(!answer.includes(CODE), 'un code est resté visible dans la réponse');
});

test('un code découpé sur plusieurs événements SSE est recollé', async () => {
  const homeDir = makeHome();
  const fragments = ['Le client ', 'PERSONNE_', 'PHYSIQUE', '_01', ' a signé.'];
  const answer = await withProxy(homeDir, (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n');
    for (const text of fragments) {
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text },
      })}\n\n`);
    }
    res.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    res.end();
  }, ({ origin }) => post(origin, JSON.stringify({ stream: true, messages: [] })));

  assert.equal(concatDeltas(answer, 'text'), `Le client ${NAME} a signé.`);
});

test('sans mapping, le proxy est transparent', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-anon-vide-'));
  const payload = JSON.stringify({ messages: [{ role: 'user', content: `Bonjour ${NAME}.` }] });
  await withProxy(homeDir, (res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  }, async ({ origin, seen }) => {
    const answer = await post(origin, payload);
    assert.equal(seen[0].body, payload);
    assert.equal(answer, '{"ok":true}');
  });
});

test('la réécriture JSON couvre les clés et les valeurs imbriquées', () => {
  const rewritten = rewriteJsonBody(
    JSON.stringify({ [NAME]: { note: `vu par ${NAME}`, liste: [NAME] } }),
    (text) => text.split(NAME).join(CODE),
  );
  assert.equal(rewritten, JSON.stringify({ [CODE]: { note: `vu par ${CODE}`, liste: [CODE] } }));
});

test('la retenue de fin de tampon est bornée', () => {
  assert.equal(heldLength('Bonjour PERSONNE_'), 'PERSONNE_'.length);
  assert.equal(heldLength('fin de phrase. '), 0);
  assert.equal(heldLength('x'.repeat(500)), 0, 'un mot démesuré ne doit pas être retenu');
});

test('un flux SSE non terminé est vidé à la fermeture', () => {
  const rewriter = createSseRewriter((text) => text.toUpperCase());
  rewriter.push(`event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'reste' },
  })}\n\n`);
  assert.match(rewriter.end(), /RESTE/);
});

test('une base locale préexistante est ignorée, une base distante est respectée', () => {
  assert.equal(resolveUpstream('http://127.0.0.1:4000/anthropic'), 'https://api.anthropic.com');
  assert.equal(resolveUpstream(undefined), 'https://api.anthropic.com');
  assert.equal(resolveUpstream('https://gateway.exemple.fr'), 'https://gateway.exemple.fr');
});

test('Codex : un code découpé dans un flux Responses est recollé', async () => {
  const homeDir = makeHome();
  const fragments = ['Le client ', 'PERSONNE_', 'PHYSIQUE', '_01', ' a signé.'];
  const answer = await withProxy(homeDir, (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const delta of fragments) {
      res.write(`event: response.output_text.delta\ndata: ${JSON.stringify({
        type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta,
      })}\n\n`);
    }
    res.write('event: response.completed\ndata: {"type":"response.completed"}\n\n');
    res.end();
  }, ({ origin }) => post(origin, JSON.stringify({ stream: true }), '/chatgpt/responses'));

  assert.equal(concatDeltas(answer, 'delta'), `Le client ${NAME} a signé.`);
  assert.ok(!answer.includes(CODE), 'un code est resté visible dans le flux Responses');
});

test('opencode : un code découpé dans un flux Chat Completions est recollé', async () => {
  const homeDir = makeHome();
  const fragments = ['Le client ', 'PERSONNE_', 'PHYSIQUE', '_01', ' a signé.'];
  const answer = await withProxy(homeDir, (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const content of fragments) {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }, ({ origin }) => post(origin, JSON.stringify({ stream: true }), '/openai/v1/chat/completions'));

  assert.equal(concatDeltas(answer, 'content'), `Le client ${NAME} a signé.`);
  assert.ok(answer.includes('[DONE]'), 'la sentinelle de fin a disparu');
});

test('un chemin sans route est refusé plutôt que relayé', async () => {
  const homeDir = makeHome();
  await withProxy(homeDir, (res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  }, async ({ origin, seen }) => {
    const answer = await post(origin, '{}', '/v1/messages');
    assert.equal(seen.length, 0, 'une requête non routée a atteint l’amont');
    assert.match(answer, /piecemaker_proxy/);
  });
});

test('opencode : la base est écrite puis retirée, une base tierce est un conflit', () => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-oc-'));
  const file = path.join(userHome, '.config', 'opencode', 'opencode.json');
  const origin = 'http://127.0.0.1:4111';

  assert.equal(configureOpencode({ origin, userHome }).configured, true);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.provider.anthropic.options.baseURL, `${origin}/anthropic`);
  assert.equal(written.provider.openai.options.baseURL, `${origin}/openai`);

  // Idempotence : un second appel ne réécrit rien.
  assert.equal(configureOpencode({ origin, userHome }).changed, false);

  assert.equal(bypassOpencode({ userHome }).bypassed, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).provider, undefined);

  fs.writeFileSync(file, JSON.stringify({ provider: { openai: { options: { baseURL: 'https://tiers.exemple.fr' } } } }));
  const conflict = configureOpencode({ origin, userHome });
  assert.equal(conflict.configured, false);
  assert.match(conflict.reason, /base-url-conflict/);
});

test('Cursor : le shim refuse tant qu’un mapping existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cursor-'));
  const binDir = path.join(dir, 'bin');
  const mappingFile = path.join(dir, 'central-mapping.json');
  const { file } = installCursorGuard({ binDir, mappingFile });

  const { execFileSync } = require('node:child_process');
  const run = () => {
    try {
      execFileSync(file, [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, stderr: '' };
    } catch (error) {
      return { code: error.status, stderr: String(error.stderr || '') };
    }
  };

  fs.writeFileSync(mappingFile, '{"mapping":{}}');
  const blocked = run();
  assert.equal(blocked.code, 78, 'le shim n’a pas bloqué alors qu’un mapping existe');
  assert.match(blocked.stderr, /PieceMaker/);

  // Sans mapping, le shim relaie : ici `cursor-agent` est absent, donc l’échec
  // vient du shell (127) et non du refus (78) — le garde-fou s’est bien effacé.
  fs.rmSync(mappingFile);
  assert.notEqual(run().code, 78);
});

test('la couverture distingue filtré, bloqué et non configuré', () => {
  const coverage = summarizeCoverage({
    claude: { configured: true, file: '/tmp/settings.json' },
    codex: { configured: false, conflict: true, reason: 'provider-conflict' },
    cursor: { blocked: true, reason: 'not-interceptable' },
  });
  assert.equal(coverage.claude.state, 'filtered');
  assert.equal(coverage.codex.state, 'unconfigured');
  assert.equal(coverage.cursor.state, 'blocked');
});

function variantsHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-anon-variants-'));
  fs.writeFileSync(path.join(dir, 'central-mapping.json'), JSON.stringify({
    version: 1,
    mapping: { 'Jean Dupont': CODE, 'M. Dupont': CODE, Dupont: CODE, US: 'ADRESSE_01' },
    reverse_mapping: { [CODE]: ['Jean Dupont', 'M. Dupont'], ADRESSE_01: ['US'] },
  }));
  return dir;
}

test('le dictionnaire expose les orthographes que le moteur code vraiment', () => {
  const dictionary = createDictionaryLoader({ homeDir: variantsHome() }).get();

  assert.equal(dictionary.canonical[CODE], 'Jean Dupont');
  assert.deepEqual(dictionary.displayNames, ['Jean Dupont', 'M. Dupont', 'Dupont']);
  assert.deepEqual(dictionary.displayAcronyms, ['US']);
});

test('tout ce qui est surligné est codé par le moteur, quelle que soit la casse', () => {
  const dictionary = createDictionaryLoader({ homeDir: variantsHome() }).get();

  for (const name of dictionary.displayNames) {
    for (const written of [name, name.toLocaleLowerCase(), name.toLocaleUpperCase()]) {
      const coded = anonymize(`avant ${written} après`, dictionary);
      assert.equal(coded.includes(written), false, `laissé en clair : ${written}`);
      assert.equal(coded.includes(CODE), true, `non codé : ${written}`);
    }
  }

  for (const acronym of dictionary.displayAcronyms) {
    assert.equal(anonymize(`avant ${acronym} après`, dictionary).includes('ADRESSE_01'), true);
  }
});

test('le retour à l\'humain ignore la casse du code et rend la forme principale', () => {
  const dictionary = createDictionaryLoader({ homeDir: variantsHome() }).get();

  assert.equal(deanonymize(`voir ${CODE}`, dictionary), 'voir Jean Dupont');
  assert.equal(deanonymize(`voir ${CODE.toLowerCase()}`, dictionary), 'voir Jean Dupont');
  assert.equal(deanonymize('voir Personne_Physique_01', dictionary), 'voir Jean Dupont');
});
