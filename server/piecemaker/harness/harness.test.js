/**
 * Harnais de citations vérifiées — capture des décisions Légifrance lues via
 * `consulter_decision` et vérification mécanique du bloc `<CITATIONS>`.
 *
 * Chaque test utilise un `homeDir` temporaire (`fs.mkdtempSync`) : jamais le
 * vrai `~/.piecemaker` de la machine.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { captureDecisions } = require('./decisions.cjs');
const { verifierReponse } = require('./verification.cjs');
const { createHarnessJuridique } = require('./index.cjs');

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-harness-'));
}

const TEXTE_COMPLET = [
  'Cour de cassation, arrêt du 12 janvier 2024',
  '',
  '=================================',
  'TEXTE INTÉGRAL:',
  '=================================',
  '',
  "Attendu que le salarié a été licencié sans cause réelle et sérieuse ;",
  '',
  'Lien: https://www.legifrance.gouv.fr/juri/id/JURITEXT000012345678',
].join('\n');

const EXTRAIT_ATTENDU = "Attendu que le salarié a été licencié sans cause réelle et sérieuse ;";

// ---------------------------------------------------------------------------
// decisions.cjs — captureDecisions
// ---------------------------------------------------------------------------

test('capture une décision consulter_decision au format Anthropic Messages (appariement tool_use/tool_result)', () => {
  const homeDir = makeHome();
  const decisionsDir = path.join(homeDir, 'decisions');
  const payload = {
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'mcp__legifrance__consulter_decision', input: { text_id: 'JURITEXT000012345678' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: TEXTE_COMPLET }] },
        ],
      },
    ],
  };

  const count = captureDecisions(payload, { decisionsDir, session: 'sess-1' });
  assert.equal(count, 1);

  const cached = JSON.parse(fs.readFileSync(path.join(decisionsDir, 'JURITEXT000012345678.json'), 'utf8'));
  assert.equal(cached.kind, 'legifrance-decision');
  assert.equal(cached.id, 'JURITEXT000012345678');
  assert.equal(cached.texte, EXTRAIT_ATTENDU);
  assert.equal(cached.source, 'proxy-piecemaker');
  assert.equal(cached.session, 'sess-1');
});

test('capture une décision consulter_decision au format OpenAI Responses (appariement call_id)', () => {
  const homeDir = makeHome();
  const decisionsDir = path.join(homeDir, 'decisions');
  const payload = {
    input: [
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'mcp__legifrance__consulter_decision',
        arguments: JSON.stringify({ id: 'CETATEXT000098765432' }),
      },
      { type: 'function_call_output', call_id: 'call_1', output: TEXTE_COMPLET },
    ],
  };

  const count = captureDecisions(payload, { decisionsDir, session: null });
  assert.equal(count, 1);

  const cached = JSON.parse(fs.readFileSync(path.join(decisionsDir, 'CETATEXT000098765432.json'), 'utf8'));
  assert.equal(cached.texte, EXTRAIT_ATTENDU);
  assert.equal(cached.source, 'proxy-piecemaker');
  assert.equal(cached.session, null);
});

test('un identifiant invalide (séparateur de chemin) n’écrit jamais hors du cache', () => {
  const homeDir = makeHome();
  const decisionsDir = path.join(homeDir, 'decisions');
  const payload = {
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mcp__legifrance__consulter_decision', input: { text_id: '../../etc/passwd' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: TEXTE_COMPLET }] }] },
    ],
  };

  const count = captureDecisions(payload, { decisionsDir, session: null });
  assert.equal(count, 0);
  assert.equal(fs.existsSync(decisionsDir), false, 'le dossier de cache n’aurait même pas dû être créé');
});

test('un résultat d’erreur (is_error) est ignoré', () => {
  const homeDir = makeHome();
  const decisionsDir = path.join(homeDir, 'decisions');
  const payload = {
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mcp__legifrance__consulter_decision', input: { text_id: 'JURITEXT000000000001' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: TEXTE_COMPLET }] }] },
    ],
  };

  assert.equal(captureDecisions(payload, { decisionsDir, session: null }), 0);
  assert.equal(fs.existsSync(path.join(decisionsDir, 'JURITEXT000000000001.json')), false);
});

test('un texte plus court que le cache existant n’écrase pas la version en cache', () => {
  const homeDir = makeHome();
  const decisionsDir = path.join(homeDir, 'decisions');
  fs.mkdirSync(decisionsDir, { recursive: true });
  const id = 'JURITEXT000011112222';
  fs.writeFileSync(path.join(decisionsDir, `${id}.json`), JSON.stringify({
    kind: 'legifrance-decision', id, texte: EXTRAIT_ATTENDU.repeat(5), caracteres: EXTRAIT_ATTENDU.repeat(5).length,
    source: 'consulter_decision', session: null, at: '2026-01-01T00:00:00.000Z',
  }));

  const payload = {
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mcp__legifrance__consulter_decision', input: { text_id: id } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: TEXTE_COMPLET }] }] },
    ],
  };

  const count = captureDecisions(payload, { decisionsDir, session: null });
  assert.equal(count, 0);
  const stillCached = JSON.parse(fs.readFileSync(path.join(decisionsDir, `${id}.json`), 'utf8'));
  assert.equal(stillCached.texte, EXTRAIT_ATTENDU.repeat(5), 'le texte plus long déjà en cache a été dégradé');
});

test('captureDecisions ne jette jamais sur une charge utile absurde', () => {
  const homeDir = makeHome();
  const decisionsDir = path.join(homeDir, 'decisions');
  assert.equal(captureDecisions(null, { decisionsDir }), 0);
  assert.equal(captureDecisions({ messages: 'pas un tableau' }, { decisionsDir }), 0);
  assert.equal(captureDecisions({ input: [{ type: 'function_call_output', call_id: 'x' }] }, { decisionsDir }), 0);
  assert.equal(captureDecisions({}, {}), 0, 'sans decisionsDir, renvoie 0 plutôt que de jeter');
});

// ---------------------------------------------------------------------------
// verification.cjs — verifierReponse
// ---------------------------------------------------------------------------

function resolversFixes({ decisionText = '', sourceText = '' } = {}) {
  return {
    getDecisionText: async () => decisionText,
    getSourceText: async () => sourceText,
  };
}

test('absence de bloc <CITATIONS> : silence total, rien n’est écrit', async () => {
  const homeDir = makeHome();
  const result = await verifierReponse('Voici une réponse sans aucune citation structurée.', { homeDir, resolvers: resolversFixes() });
  assert.deepEqual(result, { analysee: false, citations: 0, nonVerifiees: 0, details: [] });
  assert.equal(fs.existsSync(path.join(homeDir, 'citations-verifiees.jsonl')), false);
});

test('une citation trouvée exactement dans la source est vérifiée', async () => {
  const homeDir = makeHome();
  const source = "Le contrat prévoit une clause de non-concurrence de deux ans.";
  const texte = `Voici l'analyse.\n<CITATIONS>[{"ref":1,"doc_id":"piece1.md","page":1,"quote":"clause de non-concurrence de deux ans"}]</CITATIONS>`;

  const result = await verifierReponse(texte, { homeDir, session: 'sess-2', resolvers: resolversFixes({ sourceText: source }) });
  assert.equal(result.analysee, true);
  assert.equal(result.citations, 1);
  assert.equal(result.nonVerifiees, 0);
  assert.equal(result.details.length, 1);
  assert.equal(result.details[0].verified, true);
  assert.equal(result.details[0].motif, null);
});

test('une citation introuvable dans la source compte comme non vérifiée', async () => {
  const homeDir = makeHome();
  const source = "Le contrat ne prévoit aucune clause particulière.";
  const texte = `<CITATIONS>[{"ref":1,"doc_id":"piece1.md","page":1,"quote":"clause de non-concurrence de deux ans"}]</CITATIONS>`;

  const result = await verifierReponse(texte, { homeDir, resolvers: resolversFixes({ sourceText: source }) });
  assert.equal(result.analysee, true);
  assert.equal(result.nonVerifiees, 1);
  assert.equal(result.details[0].verified, false);
  assert.equal(result.details[0].motif, 'introuvable dans la source');
});

test('une citation dérivée (espaces/casse/ponctuation) est corrigée et n’est pas une faute', async () => {
  const homeDir = makeHome();
  const source = "Le contrat prévoit une clause de non-concurrence de deux ans.";
  // Quote du modèle : casse différente + espace en trop, doit être retrouvée au niveau 2.
  const texte = `<CITATIONS>[{"ref":1,"doc_id":"piece1.md","page":1,"quote":"Clause de  non-concurrence de deux ans"}]</CITATIONS>`;

  const result = await verifierReponse(texte, { homeDir, resolvers: resolversFixes({ sourceText: source }) });
  assert.equal(result.nonVerifiees, 0, 'une citation seulement dérivée ne doit jamais compter comme non vérifiée');
  assert.equal(result.details[0].verified, true);
});

test('le journal ne contient jamais le texte de la citation ni de la source', async () => {
  const homeDir = makeHome();
  const source = "Une phrase confidentielle du dossier qui ne doit jamais fuiter.";
  const quoteIntrouvable = "Une phrase qui n'existe pas dans la source.";
  const texte = `<CITATIONS>[{"ref":1,"doc_id":"piece1.md","page":1,"quote":"${quoteIntrouvable}"}]</CITATIONS>`;

  await verifierReponse(texte, { homeDir, session: 'sess-confidentiel', resolvers: resolversFixes({ sourceText: source }) });

  const logPath = path.join(homeDir, 'citations-verifiees.jsonl');
  assert.equal(fs.existsSync(logPath), true);
  const raw = fs.readFileSync(logPath, 'utf8');
  assert.ok(!raw.includes(source), 'le texte de la source a fuité dans le journal');
  assert.ok(!raw.includes(quoteIntrouvable), 'le texte de la citation a fuité dans le journal');

  const line = JSON.parse(raw.trim().split('\n')[0]);
  assert.equal(line.session_id, 'sess-confidentiel');
  assert.equal(line.non_verifiees, 1);
  assert.deepEqual(Object.keys(line.details[0]).sort(), ['id', 'motif', 'verified']);
});

test('verifierReponse ne jette jamais sur un bloc malformé', async () => {
  const homeDir = makeHome();
  const texte = '<CITATIONS>ceci n\'est pas du JSON</CITATIONS>';
  const result = await verifierReponse(texte, { homeDir, resolvers: resolversFixes() });
  assert.equal(result.nonVerifiees, 0);
});

// ---------------------------------------------------------------------------
// index.cjs — createHarnessJuridique (façade + interrupteur)
// ---------------------------------------------------------------------------

test('observerRequete n’agit que sur un corps JSON et capture la décision', () => {
  const homeDir = makeHome();
  const harnais = createHarnessJuridique({ homeDir });
  const payload = {
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mcp__legifrance__consulter_decision', input: { text_id: 'JURITEXT000099998888' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: TEXTE_COMPLET }] }] },
    ],
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8');

  assert.equal(harnais.observerRequete(body, 'text/plain', { session: 'sess-3' }), 0, 'un content-type non JSON ne doit rien capturer');
  const count = harnais.observerRequete(body, 'application/json; charset=utf-8', { session: 'sess-3' });
  assert.equal(count, 1);
  assert.equal(harnais.stats.decisions, 1);
  assert.equal(fs.existsSync(path.join(homeDir, 'decisions', 'JURITEXT000099998888.json')), true);
});

test('observerReponse retourne la forme de verifierReponse et met à jour les stats', async () => {
  const homeDir = makeHome();
  const harnais = createHarnessJuridique({ homeDir });

  const sansBloc = await harnais.observerReponse('Réponse ordinaire, sans citations.', { session: 'sess-4' });
  assert.equal(sansBloc.analysee, false);
  assert.equal(harnais.stats.tours, 0);
});

test('PIECEMAKER_CITATIONS=off neutralise les deux observateurs', async () => {
  const homeDir = makeHome();
  const previous = process.env.PIECEMAKER_CITATIONS;
  process.env.PIECEMAKER_CITATIONS = 'off';
  try {
    const harnais = createHarnessJuridique({ homeDir });
    const payload = {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mcp__legifrance__consulter_decision', input: { text_id: 'JURITEXT000011119999' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: TEXTE_COMPLET }] }] },
      ],
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8');

    assert.equal(harnais.observerRequete(body, 'application/json', { session: null }), 0);
    assert.equal(fs.existsSync(path.join(homeDir, 'decisions')), false, 'la capture a eu lieu malgré l’interrupteur');

    const texte = `<CITATIONS>[{"ref":1,"doc_id":"piece1.md","page":1,"quote":"peu importe"}]</CITATIONS>`;
    const result = await harnais.observerReponse(texte, { session: null });
    assert.deepEqual(result, { analysee: false, citations: 0, nonVerifiees: 0, details: [] });
    assert.equal(fs.existsSync(path.join(homeDir, 'citations-verifiees.jsonl')), false, 'la vérification a eu lieu malgré l’interrupteur');
  } finally {
    if (previous === undefined) delete process.env.PIECEMAKER_CITATIONS;
    else process.env.PIECEMAKER_CITATIONS = previous;
  }
});
