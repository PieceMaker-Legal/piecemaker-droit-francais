/**
 * Bout en bout du proxy PII, contre un faux amont : un nom réel ne doit jamais
 * franchir la frontière réseau, et une réponse codée doit revenir en clair —
 * y compris quand le code arrive découpé sur plusieurs événements SSE.
 *
 * Le mapping utilisé est fictif et créé dans une base SQLite temporaire ; il
 * n'a aucun rapport avec le mapping de la machine.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const { anonymize, buildDictionary, deanonymize } = require('./dictionary.cjs');
const { postThrough, startHudsuckerSession } = require('./hudsucker-fixture.cjs');
const { createSseRewriter, heldLength, rewriteJsonBody } = require('./rewrite.cjs');
const { installCursorGuard, resolveUpstream, writeTrustBundle } = require('./service.cjs');
const tls = require('node:tls');

const CODE = 'PERSONNE_PHYSIQUE_01';
const NAME = 'Jean Dupont';

function writeMappingDatabase(directory, entries) {
  const file = path.join(directory, 'auth.db');
  const database = new Database(file);
  database.exec(`
    CREATE TABLE piecemaker_nodes (project_id TEXT, id TEXT, label TEXT, PRIMARY KEY (project_id,id));
    CREATE TABLE piecemaker_mappings (project_id TEXT,node_id TEXT,real_value TEXT,masked_value TEXT,updated_at TEXT);
  `);
  const insertNode = database.prepare('INSERT OR IGNORE INTO piecemaker_nodes(project_id,id,label) VALUES(?,?,?)');
  const insertMapping = database.prepare('INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,updated_at) VALUES(?,?,?,?,?)');
  entries.forEach((entry, index) => {
    const nodeId = `n${index}`;
    insertNode.run('p', nodeId, entry.label || entry.real);
    insertMapping.run('p', nodeId, entry.real, entry.masked, '2026-01-01T00:00:00.000Z');
  });
  database.close();
  return file;
}

function makeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-anon-'));
  writeMappingDatabase(dir, [{ real: NAME, masked: CODE, label: NAME }]);
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

let activeCa = null;

async function withProxy(homeDir, respond, run, { harness } = {}) {
  const upstream = await startUpstream(respond);
  const session = await startHudsuckerSession({
    databasePath: path.join(homeDir, 'auth.db'),
    upstreamPort: upstream.port,
    harness,
  });
  activeCa = session.caFile;
  try {
    return await run({ origin: session.origin, seen: upstream.seen });
  } finally {
    activeCa = null;
    await session.close();
    await new Promise((resolve) => upstream.server.close(resolve));
  }
}

function post(origin, body, route = '/v1/messages', host = 'api.anthropic.com') {
  return postThrough(origin, activeCa, body, route, host);
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

test('la réécriture JSON préserve les clés et transforme les valeurs imbriquées', () => {
  const rewritten = rewriteJsonBody(
    JSON.stringify({ [NAME]: { note: `vu par ${NAME}`, liste: [NAME] } }),
    (text) => text.split(NAME).join(CODE),
  );
  assert.equal(rewritten, JSON.stringify({ [NAME]: { note: `vu par ${CODE}`, liste: [CODE] } }));
});

test('les entités courtes exigent des frontières et des majuscules', () => {
  const dictionary = {
    empty: false,
    mapping: { Li: 'COURT_1', Max: 'COURT_2', Paul: 'MOYEN_1', Dupont: 'LONG_1' },
  };
  const apply = (text) => anonymize(text, dictionary);

  assert.equal(apply(`LI li ALI (LI) /LI/ _LI_ \"LI\" d'LI LI,`), `COURT_1 li ALI (COURT_1) /COURT_1/ _COURT_1_ \"COURT_1\" d'COURT_1 COURT_1,`);
  assert.equal(apply('Max max MAX xMAXx'), 'Max max COURT_2 xMAXx');
  assert.equal(apply('Paul paul (PAUL) pauliste _Paul_'), 'MOYEN_1 MOYEN_1 (MOYEN_1) pauliste _MOYEN_1_');
  assert.equal(apply('Dupont xduponty DUPONT.pdf'), 'LONG_1 xLONG_1y LONG_1.pdf');
});

test('les identifiants d’appel et de résultat restent appariés', () => {
  const toolUseId = 'toolu_01JeanDupont_X';
  const payload = {
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'rechercher', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Résultat' }] },
    ],
  };
  const rewritten = JSON.parse(rewriteJsonBody(
    JSON.stringify(payload),
    (text) => text.split('JeanDupont').join(CODE),
  ));

  assert.equal(rewritten.messages[0].content[0].id, toolUseId);
  assert.equal(rewritten.messages[1].content[0].tool_use_id, toolUseId);
});

test('les schémas gardent leur contrat et anonymisent leurs données', () => {
  const payload = {
    max_tokens: 1000,
    tools: [{
      name: NAME,
      description: `Recherche ${NAME}`,
      input_schPERS_MORALE_7: {
        type: 'object',
        properties: { client: { type: 'string', enum: [NAME] } },
        required: ['client'],
      },
    }],
  };
  const rewritten = JSON.parse(rewriteJsonBody(
    JSON.stringify(payload),
    (text) => text.split(NAME).join(CODE),
  ));
  const functionCall = JSON.parse(rewriteJsonBody(
    JSON.stringify({
      function_call: { name: 'rechercher', arguments: JSON.stringify({ client: CODE }) },
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'rechercher', input: { id: CODE } }],
    }),
    (text) => text.split(CODE).join(NAME),
  ));

  assert.equal(rewritten.max_tokens, 1000);
  assert.equal(rewritten.tools[0].name, NAME);
  assert.equal(rewritten.tools[0].description, `Recherche ${CODE}`);
  assert.equal(rewritten.tools[0].input_schPERS_MORALE_7.type, 'object');
  assert.deepEqual(rewritten.tools[0].input_schPERS_MORALE_7.required, ['client']);
  assert.deepEqual(rewritten.tools[0].input_schPERS_MORALE_7.properties.client.enum, [CODE]);
  assert.equal(functionCall.function_call.name, 'rechercher');
  assert.deepEqual(JSON.parse(functionCall.function_call.arguments), { client: NAME });
  assert.equal(functionCall.content[0].id, 'toolu_1');
  assert.deepEqual(functionCall.content[0].input, { id: NAME });
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

test('Anthropic réidentifie les arguments fragmentés d’un outil', () => {
  const rewriter = createSseRewriter((text) => text.split(CODE).join(NAME));
  const fragments = ['{"client":"PERSONNE_', 'PHYSIQUE_01', '"}'];
  let answer = '';
  for (const partial_json of fragments) {
    answer += rewriter.push(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json },
    })}\n\n`);
  }
  answer += rewriter.push('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
  answer += rewriter.end();
  const argumentsText = answer
    .split('\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice(6)).delta?.partial_json || '')
    .join('');
  assert.deepEqual(JSON.parse(argumentsText), { client: NAME });
});

test('Responses réidentifie les arguments fragmentés d’un outil', () => {
  const rewriter = createSseRewriter((text) => text.split(CODE).join(NAME));
  const fragments = ['{"client":"PERSONNE_', 'PHYSIQUE_01', '"}'];
  let answer = '';
  for (const delta of fragments) {
    answer += rewriter.push(`event: response.function_call_arguments.delta\ndata: ${JSON.stringify({
      type: 'response.function_call_arguments.delta', item_id: 'call_1', output_index: 0, delta,
    })}\n\n`);
  }
  answer += rewriter.push('event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","item_id":"call_1","output_index":0}\n\n');
  answer += rewriter.end();
  const argumentsText = answer
    .split('\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice(6)).delta || '')
    .join('');
  assert.deepEqual(JSON.parse(argumentsText), { client: NAME });
});

test('Chat Completions réidentifie les arguments fragmentés d’un outil', () => {
  const rewriter = createSseRewriter((text) => text.split(CODE).join(NAME));
  const fragments = ['{"client":"PERSONNE_', 'PHYSIQUE_01', '"}'];
  let answer = '';
  fragments.forEach((argumentsText, index) => {
    answer += rewriter.push(`data: ${JSON.stringify({
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { ...(index === 0 ? { name: 'rechercher' } : {}), arguments: argumentsText } }] },
        finish_reason: null,
      }],
    })}\n\n`);
  });
  answer += rewriter.push('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n');
  answer += rewriter.end();
  const argumentsText = answer
    .split('\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice(6)))
    .flatMap((event) => event.choices || [])
    .flatMap((choice) => choice.delta?.tool_calls || [])
    .map((toolCall) => toolCall.function?.arguments || '')
    .join('');
  assert.deepEqual(JSON.parse(argumentsText), { client: NAME });
});
test('un chemin d’API est filtré quel que soit son préfixe', async () => {
  const homeDir = makeHome();
  await withProxy(homeDir, (res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  }, async ({ origin, seen }) => {
    const answer = await post(origin, JSON.stringify({ note: NAME }), '/v1/messages');
    assert.equal(seen.length, 1);
    assert.ok(seen[0].body.includes(CODE));
    assert.ok(!seen[0].body.includes(NAME));
    assert.equal(answer, '{"ok":true}');
  });
});

test('le premier événement SSE part avant la fin du flux', async () => {
  const homeDir = makeHome();
  let release = () => {};
  const hold = new Promise((resolve) => { release = resolve; });
  const { ProxyAgent, fetch } = await import('undici');
  const answer = await withProxy(homeDir, async (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bonjour. ' },
    })}\n\n`);
    await hold;
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: CODE },
    })}\n\n`);
    res.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    res.end();
  }, async ({ origin }) => {
    const agent = new ProxyAgent({ uri: origin, requestTls: { ca: fs.readFileSync(activeCa) } });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true }),
      dispatcher: agent,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), Math.max(1, deadline - Date.now()))),
      ]);
      if (next.timedOut) break;
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
      if (text.includes('Bonjour')) release();
    }
    return text;
  });
  assert.ok(answer.includes('Bonjour'), 'le premier token n’est pas sorti avant la fin du flux');
  assert.ok(answer.includes(NAME), 'le code tenu jusqu’à la fin du bloc n’a pas été réidentifié');
});

test('Cursor : le shim refuse tant qu’un mapping existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cursor-'));
  const binDir = path.join(dir, 'bin');
  const mappingFile = path.join(dir, 'central-mapping.json');
  const { file } = installCursorGuard({ binDir, mappingFile });

  const { execFileSync } = require('node:child_process');
  const run = () => {
    try {
      execFileSync(file, [], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
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

function variantsDictionary() {
  return buildDictionary({
    mapping: { 'Jean Dupont': CODE, 'M. Dupont': CODE, Dupont: CODE, US: 'ADRESSE_01' },
    reverse_mapping: { [CODE]: ['Jean Dupont', 'M. Dupont'], ADRESSE_01: ['US'] },
  }, 1);
}

test('le dictionnaire expose les orthographes que le moteur code vraiment', () => {
  const dictionary = variantsDictionary();

  assert.equal(dictionary.canonical[CODE], 'Jean Dupont');
  assert.deepEqual(dictionary.displayNames, ['Jean Dupont', 'M. Dupont', 'Dupont']);
  assert.deepEqual(dictionary.displayAcronyms, ['US']);
});

test('tout ce qui est surligné est codé par le moteur, quelle que soit la casse', () => {
  const dictionary = variantsDictionary();

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
  const dictionary = variantsDictionary();

  assert.equal(deanonymize(`voir ${CODE}`, dictionary), 'voir Jean Dupont');
  assert.equal(deanonymize(`voir ${CODE.toLowerCase()}`, dictionary), 'voir Jean Dupont');
  assert.equal(deanonymize('voir Personne_Physique_01', dictionary), 'voir Jean Dupont');
});

test('le bundle de confiance garde les racines publiques et ajoute l’autorité locale', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-trust-'));
  try {
    const caFile = path.join(directory, 'ca.crt');
    const localCa = '-----BEGIN CERTIFICATE-----\nLOCALE\n-----END CERTIFICATE-----';
    fs.writeFileSync(caFile, `${localCa}\n`);
    const bundle = fs.readFileSync(writeTrustBundle(caFile, path.join(directory, 'bundle.pem')), 'utf8');
    assert.ok(bundle.includes(tls.rootCertificates[0]));
    assert.ok(bundle.includes(localCa));
    assert.equal(bundle.match(/BEGIN CERTIFICATE/g).length, tls.rootCertificates.length + 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('les événements finaux Responses (.done, completed) et Anthropic (content_block_start) sont restitués', () => {
  const rewriter = createSseRewriter((text) => text.replaceAll('PERSONNE_PHYSIQUE_01', 'Jean Dupont'));
  const events = [
    { type: 'response.output_text.done', item_id: 'i1', text: 'Signé par PERSONNE_PHYSIQUE_01.' },
    { type: 'response.output_item.done', item: { id: 'i1', type: 'message', content: [{ type: 'output_text', text: 'Signé par PERSONNE_PHYSIQUE_01.' }] } },
    { type: 'response.completed', response: { id: 'r1', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Signé par PERSONNE_PHYSIQUE_01.' }] }] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'PERSONNE_PHYSIQUE_01' } },
  ];
  const output = rewriter.push(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')) + rewriter.end();
  assert.ok(!output.includes('PERSONNE_PHYSIQUE_01'), output);
  assert.equal(output.split('Jean Dupont').length - 1, 4);
  assert.ok(output.includes('"id":"r1"'));
});
