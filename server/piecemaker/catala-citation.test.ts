import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ReasoningConnectors } from '@/modules/piecemaker-reasoning/index.js';

import { createCatalaCitation } from './catala-citation.js';
import { createCitationStore } from './harness/citation-store.js';

test('opens declared Catala references in the citation reader without inventing quote verification', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-citations-'));
  try {
    const store = createCitationStore(home);
    let queries = 0;
    const connectors: Pick<ReasoningConnectors, 'source' | 'match'> = {
      source: async () => { queries++; return { kind: 'texte', title: 'Article fictif', text: 'Texte officiel fictif. Texte "officiel" fictif.', validity: { from: '2020-01-01', to: null } }; },
      match: (text: string, quote: string) => text.includes(quote) ? quote : null,
    };
    const { cite } = createCatalaCitation(connectors, store);
    const content = '## Article | LEGIARTI000000000001\nCitation : « Texte officiel fictif. »\nCitation : « Texte différent. »';
    for (const [quote, verified] of [['Texte officiel fictif.', true], ['Texte différent.', false], ['', false]] as const) {
      const token = await cite('/dossier-fictif', 'LEGIARTI000000000001', quote, content);
      const saved = await store.read(token);
      assert.equal(saved?.citation.verified, verified);
      assert.equal(saved?.sessionId, 'catala:/dossier-fictif');
      assert.equal(saved?.citation.article_id, 'LEGIARTI000000000001');
      assert.equal(saved?.title, 'Article fictif');
      assert.match(saved!.source, /Validité : 2020-01-01/);
      if (verified) assert.equal(saved!.source.slice(saved!.ranges[0].start, saved!.ranges[0].end), quote);
    }
    await assert.rejects(() => cite('/dossier-fictif', 'LEGIARTI000000000002', '', content), /Source absente/);
    await assert.rejects(() => cite('/dossier-fictif', 'LEGIARTI000000000001', 'Citation injectée', content), /Citation absente/);
    assert.equal(queries, 3);
    const annotated = '```catala\n#[doc=' + JSON.stringify('source: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001\nquote: « Texte "officiel" fictif. »') + ']\ndéfinition possible égal à vrai\n```';
    const nativeReport = await createCatalaCitation(connectors, store).verify('/dossier-fictif', [{ nom: 'demo.catala_fr', chemin: '/dossier-fictif/demo.catala_fr', contenu: annotated }]);
    assert.equal(nativeReport.passed, true);
    assert.equal(nativeReport.results.length, 1);
    assert.equal(nativeReport.results[0].quote, 'Texte "officiel" fictif.');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('checks all declared quotations, retains missing and failed citations and stores reader results', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-citations-'));
  try {
    const store = createCitationStore(home);
    const service = createCatalaCitation({
      source: async (_cwd, id) => ({ kind: id.startsWith('/') ? 'piece' : 'texte', title: 'Source fictive', text: 'Passage exact.' }),
      match: (text, quote) => text.includes(quote) ? quote : null,
    }, store);
    const origin = path.join(home, '.piecemaker/catala/prime/prime.catala_fr');
    const content = '## Article fictif | LEGIARTI000000000001\nCitation : « Passage exact. »\n\n```catala\ndéfinition montant égal à 1\n```\n\n## Autre règle\n[Article cité](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001)\nCitation : « Passage différent. »\n\n```catala\ndéfinition montant égal à 2\n```\n\n## Pièces\n[Pièce fictive](../../../pieces/attestation.md)\nCitation : « Passage exact. »\n\n[Pièce sans extrait](../../../pieces/contrat.md)\n\n[Pièce interdite](../../../../secret.md)\n';
    const result = await service.verify(home, [{ nom: 'prime.catala_fr', chemin: origin, contenu: content }]);
    assert.equal(result.passed, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.results.length, 5);
    assert.equal(result.results.filter((entry) => entry.status === 'passed').length, 2);
    assert.equal(result.results.find((entry) => entry.quote === 'Passage différent.')?.status, 'failed');
    assert.match(result.results.find((entry) => entry.label === 'Pièce sans extrait')!.message, /Aucun extrait/);
    assert.match(result.results.find((entry) => entry.label === 'Pièce interdite')!.message, /hors du dossier/);
    for (const entry of result.results) if ('token' in entry) assert.equal((await store.read(entry.token))?.citation.verified, entry.verified);
    const empty = await service.verify(home, [{ nom: 'vide.catala_fr', chemin: origin, contenu: 'Aucune source.' }]);
    assert.equal(empty.status, 'missing');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('verifies Judilibre and constitutional decisions through the existing source connector', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-decisions-'));
  try {
    const requested: string[] = [];
    const service = createCatalaCitation({ source: async (_cwd, id) => { requested.push(id); return { kind: 'decision', title: 'Cour fictive, 12 mars 2026', text: 'Extrait exact.' }; }, match: (text, quote) => text.includes(quote) ? quote : null }, createCitationStore(home));
    const ids = ['abcdef0123456789abcdef01', 'CONSTEXT000000000001'];
    const urls = [`https://www.courdecassation.fr/decision/${ids[0]}`, `https://www.legifrance.gouv.fr/cons/id/${ids[1]}`];
    const contenu = urls.map((url, index) => `## Décision ${index}\n[Jurisprudence fictive](${url})\nCitation : « Extrait exact. »`).join('\n');
    const report = await service.verify(home, [{ nom: 'demo.catala_fr', chemin: path.join(home, 'demo.catala_fr'), contenu }]);
    assert.equal(report.passed, true);
    assert.deepEqual(requested, ids);
    assert.ok(report.results.every((entry) => 'title' in entry && entry.title === 'Cour fictive, 12 mars 2026'));
    const rejected = await service.verify(home, [{ nom: 'demo.catala_fr', chemin: path.join(home, 'demo.catala_fr'), contenu: contenu.replace('www.courdecassation.fr', 'www.courdecassation.fr.example.test') }]);
    assert.equal(rejected.passed, false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('develops an OKF premise into its cited pieces and fails without evidence', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-premise-'));
  try {
    const bundle = path.join(home, '.piecemaker', 'okf');
    await mkdir(path.join(bundle, 'Pièces'), { recursive: true });
    await mkdir(path.join(bundle, '_premises'), { recursive: true });
    await writeFile(path.join(bundle, 'Pièces', 'Contrat.pdf.md'), '---\ntype: Pièces\ntitle: Contrat.pdf\nresource: Pièces/Contrat.pdf\nrelations:\n  states:\n    - target: /_premises/prix.md\n      citation: Le prix est de 1 000 euros.\n      origin: piecemaker/agent\n      value: 1 000 euros\n---\n');
    await writeFile(path.join(bundle, '_premises', 'prix.md'), '---\ntype: Premise\ntitle: Prix\n---\n');
    await writeFile(path.join(bundle, '_premises', 'delai.md'), '---\ntype: Premise\ntitle: Délai\n---\n');
    const read: string[] = [];
    const service = createCatalaCitation({
      source: async (_cwd, id) => { read.push(id); return { kind: 'piece', title: 'Contrat.pdf', text: 'Le prix est de 1 000 euros.' }; },
      match: (text, quote) => text.includes(quote) ? quote : null,
    }, createCitationStore(home));
    const origin = path.join(home, '.piecemaker/catala/prime/prime.catala_fr');
    const doc = (title: string, source: string) => '#[doc=' + JSON.stringify(`titre: ${title}\nsource: ${source}`) + ']';
    const content = ['```catala', doc('Prix', 'okf:/_premises/prix.md'), 'définition a égal à vrai', doc('Délai', 'okf:/_premises/delai.md'), 'définition b égal à vrai', doc('Absente', 'okf:/_premises/absente.md'), 'définition c égal à vrai', '```'].join('\n');
    const report = await service.verify(home, [{ nom: 'prime.catala_fr', chemin: origin, contenu: content }]);
    const result = (target: string) => report.results.find((entry) => entry.target === target) as { status: string; title?: string; pieces?: Array<{ target: string; quote: string; verified: boolean }> };
    assert.equal(report.passed, false);
    assert.equal(result('okf:/_premises/prix.md').status, 'passed');
    assert.equal(result('okf:/_premises/prix.md').title, 'Prix');
    assert.deepEqual(result('okf:/_premises/prix.md').pieces?.map((piece) => [piece.target, piece.quote, piece.verified]), [[encodeURI('../../../Pièces/Contrat.pdf'), 'Le prix est de 1 000 euros.', true]]);
    assert.deepEqual(read, [path.join(home, 'Pièces/Contrat.pdf')]);
    assert.equal(result('okf:/_premises/delai.md').status, 'missing');
    assert.equal(result('okf:/_premises/absente.md').status, 'failed');
  } finally { await rm(home, { recursive: true, force: true }); }
});
