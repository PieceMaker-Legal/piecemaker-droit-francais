import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { SourceConnectors } from '@/modules/piecemaker-suivi/index.js';

import { createCatalaCitation, historyNeeded } from './catala-citation.js';
import { createCitationStore } from './harness/citation-store.js';
import { createSourceConnectors } from './source-connectors.js';

test('opens declared Catala references in the citation reader without inventing quote verification', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-citations-'));
  try {
    const store = createCitationStore(home);
    let queries = 0;
    const connectors: Pick<SourceConnectors, 'source' | 'match'> = {
      source: async () => { queries++; return { kind: 'texte', title: 'Article fictif', text: 'Texte officiel fictif. Texte "officiel" fictif.', validity: { from: '2020-01-01', to: null } }; },
      match: (text: string, quote: string) => text.includes(quote) ? quote : null,
    };
    const { cite } = createCatalaCitation(connectors, store);
    const content = '## Article | LEGIARTI000000000001\n« Texte officiel fictif. »\n« Texte différent. »';
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
    const annotated = '## Article | LEGIARTI000000000001\n« Texte "officiel" fictif. »\n\n```catala\ndéfinition possible égal à vrai\n```';
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
    const content = '## Article fictif | LEGIARTI000000000001\n« Passage exact. »\n\n```catala\ndéfinition montant égal à 1\n```\n\n## Autre règle\n[Article cité](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001)\nCitation : « Passage différent. »\n\n```catala\ndéfinition montant égal à 2\n```\n\n## Pièces\n[Pièce fictive](../../../pieces/attestation.md)\nCitation : « Passage exact. »\n\n[Pièce sans extrait](../../../pieces/contrat.md)\n\n[Pièce interdite](../../../../secret.md)\n';
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

test('a cross-reference inside the official article text needs no source, one written outside it does', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-officiel-'));
  try {
    const service = createCatalaCitation({
      source: async () => ({ kind: 'texte', title: 'Article 1229', text: 'La résolution met fin au contrat.' }),
      match: (text, quote) => text.includes(quote) ? quote : null,
    }, createCitationStore(home));
    const file = (extra: string) => [{ nom: 'resolution.catala_fr', chemin: path.join(home, 'resolution.catala_fr'), contenu: `## Article 1229 | LEGIARTI000000000001\n\n« La résolution met fin au contrat. »\n\nLa résolution met fin au contrat.\n\nLes restitutions ont lieu dans les conditions prévues aux articles 1352 à 1352-9.\n\n\`\`\`catala\ndéfinition résolu égal à vrai\n\`\`\`\n${extra}` }];
    const official = await service.verify(home, file(''));
    assert.equal(official.passed, true);
    assert.equal(official.results.length, 1);
    const written = await service.verify(home, file('\n## Restitutions\n\nVoir les articles 1352 et suivants.\n'));
    assert.equal(written.passed, false);
    assert.match(written.results.find((entry) => !entry.target)!.message, /Lien de source absent/);
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

test('a scenario fact justified by a premise is checked against the stated value and flags a lawyer link', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-fact-'));
  try {
    const bundle = path.join(home, '.piecemaker', 'okf');
    await mkdir(path.join(bundle, 'Pièces'), { recursive: true });
    await mkdir(path.join(bundle, '_premises'), { recursive: true });
    await writeFile(path.join(bundle, 'Pièces', 'Contrat.pdf.md'), '---\ntype: Pièces\ntitle: Contrat.pdf\nresource: Pièces/Contrat.pdf\nrelations:\n  states:\n    - target: /_premises/prix.md\n      citation: Le prix est de 1 000 euros.\n      origin: piecemaker/avocat\n      value: 1 000 euros\n---\n');
    await writeFile(path.join(bundle, '_premises', 'prix.md'), '---\ntype: Premise\ntitle: Prix\n---\n');
    const service = createCatalaCitation({
      source: async () => ({ kind: 'piece', title: 'Contrat.pdf', text: 'Le prix est de 1 000 euros.' }),
      match: (text, quote) => text.includes(quote) ? quote : null,
    }, createCitationStore(home));
    const origin = path.join(home, '.piecemaker/catala/prime/test_prime.catala_fr');
    const scenario = (value: string) => ['```catala', '#[test]', "déclaration champ d'application Essai:", '  résultat cas champ d\'application Prime', '', "champ d'application Essai:", '  ## okf:/_premises/prix.md', `  définition cas.prix égal à ${value}`, '  assertion cas.montant = 0 €', '```'].join('\n');
    const good = await service.verify(home, [{ nom: 'test_prime.catala_fr', chemin: origin, contenu: scenario('1 000 €') }]);
    assert.equal(good.passed, true);
    assert.deepEqual(good.warnings, ['okf:/_premises/prix.md : lien posé par l’avocat, vérification manuelle requise.']);
    const bad = await service.verify(home, [{ nom: 'test_prime.catala_fr', chemin: origin, contenu: scenario('2 000 €') }]);
    assert.equal(bad.passed, false);
    assert.match(bad.results[0].message, /Valeur du scénario \(2 000 €\) différente de la prémisse/);
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
    const content = ['[Prix](okf:/_premises/prix.md)', '', '[Délai](okf:/_premises/delai.md)', '', '[Absente](okf:/_premises/absente.md)'].join('\n');
    const report = await service.verify(home, [{ nom: 'prime.catala_fr', chemin: origin, contenu: content }]);
    const result = (target: string) => report.results.find((entry) => entry.target === target) as { status: string; title?: string; pieces?: Array<{ target: string; quote: string; verified: boolean }> };
    assert.equal(report.passed, false);
    assert.equal(result('okf:/_premises/prix.md').status, 'passed');
    assert.equal(result('okf:/_premises/prix.md').title, 'Prix');
    assert.deepEqual(result('okf:/_premises/prix.md').pieces?.map((piece) => [piece.target, piece.quote, piece.verified]), [[encodeURI('../../../Pièces/Contrat.pdf'), 'Le prix est de 1 000 euros.', true]]);
    assert.deepEqual(read, [path.join(home, 'Pièces/Contrat.pdf')]);
    assert.equal(result('okf:/_premises/delai.md').status, 'missing');
    assert.equal(result('okf:/_premises/absente.md').status, 'failed');
    assert.equal(report.status, 'failed');
  } finally { await rm(home, { recursive: true, force: true }); }
});

const appealsConnectors = (details: string[] | undefined, text = 'Extrait exact.', requested: string[] = []): Pick<SourceConnectors, 'source' | 'match'> => ({
  source: async (_cwd, id) => { requested.push(id); return { kind: 'decision', title: 'Cour fictive, 12 mars 2026', text, ...(details ? { history: { statut: 'remise en cause' as const, details } } : {}) }; },
  match: (found: string, quote: string) => found.includes(quote) ? quote : null,
});
const APPEAL = 'Recours JURITEXT000000000009 du 2026-05-06 (Cour de cassation)';

test('a decision with an appeal carries a mention without the identifier and a valid citation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-appeal-'));
  try {
    const store = createCitationStore(home);
    const withAppeal = createCatalaCitation(appealsConnectors([APPEAL, 'Autre ligne']), store);
    const contenu = '## Décision fictive | JURITEXT000000000001\n« Extrait exact. »';
    const report = await withAppeal.verify(home, [{ nom: 'demo.catala_fr', chemin: path.join(home, 'demo.catala_fr'), contenu }]);
    const result = report.results[0] as { status: string; mention?: string; recours?: unknown[]; target: string };
    assert.equal(report.passed, true);
    assert.equal(result.status, 'passed');
    assert.equal(result.mention, 'Non rendue en dernier ressort, voir Cour de cassation, 2026-05-06');
    assert.doesNotMatch(result.mention!, /JURITEXT/);
    assert.deepEqual(result.recours, [{ id: 'JURITEXT000000000009', date: '2026-05-06', juridiction: 'Cour de cassation' }]);
    const without = await createCatalaCitation(appealsConnectors(['Autre ligne']), store).verify(home, [{ nom: 'demo.catala_fr', chemin: path.join(home, 'demo.catala_fr'), contenu }]);
    assert.equal(without.passed, true);
    assert.ok(!('mention' in without.results[0]) && !('recours' in without.results[0]));
    const none = await createCatalaCitation(appealsConnectors(undefined), store).verify(home, [{ nom: 'demo.catala_fr', chemin: path.join(home, 'demo.catala_fr'), contenu }]);
    assert.ok(!('mention' in none.results[0]));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('cite opens an appeal only through a parent decision of the program that lists it', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-appeal-'));
  try {
    const store = createCitationStore(home);
    const requested: string[] = [];
    const { cite } = createCatalaCitation({
      source: async (cwd, id) => { requested.push(id); return id === 'JURITEXT000000000001' ? { kind: 'decision', title: 'Cour d’appel fictive', text: 'Extrait exact.', history: { statut: 'remise en cause', details: [APPEAL] } } : { kind: 'decision', title: 'Cour de cassation fictive', text: 'Arrêt fictif.' }; },
      match: (text, quote) => text.includes(quote) ? quote : null,
    }, store);
    const content = '## Décision fictive | JURITEXT000000000001\n« Extrait exact. »';
    const token = await cite('/dossier-fictif', 'JURITEXT000000000009', '', content, 'JURITEXT000000000001');
    const saved = await store.read(token);
    assert.equal(saved?.title, 'Cour de cassation fictive');
    assert.equal(saved?.citation.decision_id, 'JURITEXT000000000009');
    await assert.rejects(() => cite('/dossier-fictif', 'JURITEXT000000000009', '', content), /Source absente/);
    await assert.rejects(() => cite('/dossier-fictif', 'JURITEXT000000000009', '', content, 'JURITEXT000000000002'), /Source absente/);
    await assert.rejects(() => cite('/dossier-fictif', 'JURITEXT000000000008', '', content, 'JURITEXT000000000001'), /Source absente/);
    assert.equal(requested.filter((id) => id === 'JURITEXT000000000002').length, 0);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('accepts a JORFARTI article as a citation source', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-jorf-'));
  try {
    const store = createCitationStore(home);
    const service = createCatalaCitation({ source: async () => ({ kind: 'texte', title: 'Article fictif', text: 'Extrait exact.' }), match: (text, quote) => text.includes(quote) ? quote : null }, store);
    const content = '## Article fictif | JORFARTI000000000001\n« Extrait exact. »';
    const token = await service.cite('/dossier-fictif', 'JORFARTI000000000001', 'Extrait exact.', content);
    assert.equal((await store.read(token))?.citation.verified, true);
    const url = 'https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000000000001';
    const report = await service.verify(home, [{ nom: 'demo.catala_fr', chemin: path.join(home, 'demo.catala_fr'), contenu: `## Article fictif\n[Article](${url})\nCitation : « Extrait exact. »` }]);
    assert.equal(report.passed, true);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a quotation with a stray dot or space is corrected and verified, a different word fails', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-correction-'));
  try {
    const store = createCitationStore(home);
    const service = createCatalaCitation({
      source: async () => ({ kind: 'texte', title: 'Article fictif', text: 'Le salarié perçoit une prime.' }),
      match: (text, quote) => { const found = 'Le salarié perçoit une prime'; return quote.replace(/\s+/g, ' ').replace(/\.$/, '') === found && text.includes(found) ? found : null; },
    }, store);
    const run = (quote: string) => service.verify(home, [{ nom: 'demo.catala_fr', chemin: path.join(home, 'demo.catala_fr'), contenu: `## Article fictif | LEGIARTI000000000001\n« ${quote} »` }]);
    for (const quote of ['Le salarié perçoit une prime.', 'Le salarié  perçoit une prime']) {
      const report = await run(quote);
      const result = report.results[0] as { status: string; verified: boolean; correction?: { avant: string; apres: string } };
      assert.equal(report.passed, true);
      assert.equal(result.status, 'passed');
      assert.equal(result.verified, true);
      assert.deepEqual(result.correction, { avant: quote, apres: 'Le salarié perçoit une prime' });
    }
    const exact = (await run('Le salarié perçoit une prime')).results[0] as { correction?: unknown };
    assert.equal(exact.correction, undefined);
    const different = await run('Le salarié perçoit une indemnité');
    assert.equal(different.passed, false);
    assert.equal(different.results[0].status, 'failed');
    assert.equal((different.results[0] as { correction?: unknown }).correction, undefined);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('the connector returns the official wording when only spaces or punctuation differ', () => {
  const { match } = createSourceConnectors();
  const text = 'Le salarié perçoit une prime, sauf faute grave.';
  assert.equal(match(text, 'Le salarié perçoit une prime, sauf faute grave.'), 'Le salarié perçoit une prime, sauf faute grave.');
  assert.equal(match(text, 'Le salarié  perçoit une prime, sauf faute grave. '), 'Le salarié perçoit une prime, sauf faute grave.');
  assert.equal(match(text, 'Le salarié perçoit une prime sauf faute grave'), 'Le salarié perçoit une prime, sauf faute grave');
  assert.equal(match(text, 'Le salarié perçoit une indemnité, sauf faute grave.'), null);
});

test('a Légifrance citation already validated is reused without querying the source again, a failed one is checked again', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-validees-'));
  try {
    await mkdir(path.join(home, '.piecemaker', 'catala'), { recursive: true });
    const store = createCitationStore(home);
    const queried: string[] = [];
    const service = createCatalaCitation({ source: async (_cwd, id) => { queried.push(id); return { kind: 'texte', title: 'Article fictif', text: 'Extrait exact.' }; }, match: (text, quote) => text.includes(quote) ? quote : null }, store);
    const files = [{ nom: 'demo.catala_fr', chemin: path.join(home, 'demo.catala_fr'), contenu: '## Article fictif | LEGIARTI000000000001\n« Extrait exact. »\n\n## Autre article | LEGIARTI000000000002\n« Extrait inventé. »' }];
    const first = await service.verify(home, files);
    const second = await service.verify(home, files);
    assert.deepEqual(queried, ['LEGIARTI000000000001', 'LEGIARTI000000000002', 'LEGIARTI000000000002']);
    assert.deepEqual(second.results.map((entry) => [entry.status, 'token' in entry && entry.token]), first.results.map((entry) => [entry.status, 'token' in entry && entry.token]));
    assert.equal(second.results[0].verified, true);
    await rm(path.join(home, 'citation-sources'), { recursive: true, force: true });
    await service.verify(home, files);
    assert.equal(queried.filter((id) => id === 'LEGIARTI000000000001').length, 2);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a decision less than five years old keeps the remote history check, an older one is reused', async () => {
  const now = new Date(2026, 10, 15);
  assert.equal(historyNeeded('LEGIARTI000000000001', 'Article fictif', now), false);
  assert.equal(historyNeeded('JURITEXT000000000001', 'Cour de cassation, civile, Chambre commerciale, 4 septembre 2024, 23-00.000, Inédit', now), true);
  assert.equal(historyNeeded('JURITEXT000000000001', 'Cour de cassation, civile, Chambre commerciale, 1er mars 2021, 20-00.000, Inédit', now), false);
  assert.equal(historyNeeded('0123456789abcdef01234567', 'Cour d’appel de Paris, 16 novembre 2021', now), true);
  assert.equal(historyNeeded('CETATEXT000000000001', 'Conseil d’État', now), true);
});
