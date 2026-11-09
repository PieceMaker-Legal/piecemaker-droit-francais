import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { human, reasoning, reasoningCard, reasoningGraph, reasoningIssues, reasoningText } from './graph.ts';

globalThis.DOMParser = new JSDOM().window.DOMParser;

test('keeps scenario truth separate from evidence, including a false input', () => {
  for (const [value, expected] of [['true', 'Oui'], ['false', 'Non']]) {
    const model = reasoning(`digraph G {
      x001 [label=<<table><tr><td>demande</td><td>${value}</td></tr></table>>];
      subgraph cluster_inputs { x001; }
    }`);
    const card = new JSDOM(reasoningCard(model.steps[0], model)).window.document;
    assert.equal(card.querySelector('.pmc-value').textContent, expected);
    assert.doesNotMatch(card.body.textContent, /Établi|Non établi/);
    assert.match(card.body.textContent, /Hypothèse du scénario/);
    assert.match(reasoningIssues(model)[0].issue, /pièce/i);
  }
});

const module = {
  nom: 'resolution.catala_fr',
  chemin: '/dossiers/exemple/.piecemaker/catala/resolution/resolution.catala_fr',
  contenu: `> Module Resolution

## Article 1226 du code civil

[Article 1226](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041472)
Citation : « Le créancier peut, à ses risques et périls, résoudre le contrat par voie de notification. »

\`\`\`catala-metadata
déclaration champ d'application RésolutionUnilatérale:
  entrée mise_en_demeure contenu booléen
  résultat résolution_possible contenu booléen
\`\`\`

\`\`\`catala
champ d'application RésolutionUnilatérale:
  définition résolution_possible égal à mise_en_demeure
\`\`\`

## Pièce 2

Concerne : mise_en_demeure

[Pièce 2, lettre](../../../pieces/lettre-jean-dupont.md)
Citation : « Société Exemple SAS est mise en demeure de livrer. »

## Article 1104

[Article 1104](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032040794)
`,
};

const dot = `digraph G {
  x001 [label=<<table><tr><td>mise_en_demeure</td><td>true</td></tr></table>>, URL="https://catala.local/test_resolution.catala_fr#L8", style="filled"];
  x002 [label=<<table><tr><td>résolution_possible</td></tr><tr><td>mise_en_demeure</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>, URL="https://catala.local/resolution.catala_fr#L16", style="filled"];
  x003 [label=<<table><tr><td>Resolution.RésolutionUnilatérale</td></tr><tr><td>résolution_possible</td></tr><tr><td>true</td></tr></table>>, shape=plaintext];
  subgraph cluster_inputs { x001; }
  x001 -> x002 [style="solid"];
  x002 -> x003 [style="solid"];
}`;

const citations = [
  { origin: module.chemin, target: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041472', quote: 'Le créancier peut, à ses risques et périls, résoudre le contrat par voie de notification.', status: 'passed', title: 'Code civil, article 1226', id: 'LEGIARTI000032041472' },
  { origin: module.chemin, target: '../../../pieces/lettre-jean-dupont.md', quote: 'Société Exemple SAS est mise en demeure de livrer.', status: 'failed' },
];

test('turns the trace into facts and rules written for a lawyer', () => {
  const model = reasoning(dot, [module], citations);
  assert.deepEqual(model.steps.map((step) => [step.kind, step.title, step.value, step.answer]), [
    ['fact', 'Mise en demeure', 'Vrai', false],
    ['rule', 'Résolution possible', 'Vrai', true],
  ]);
  const [fact, rule] = model.steps;
  assert.deepEqual(rule.parents, [fact.id]);
  assert.deepEqual(rule.sources.map((source) => [source.label, source.kind, source.title]), [['Article 1226', 'article', 'Code civil, article 1226']]);
  assert.match(rule.sources[0].quote, /résoudre le contrat/);
  assert.deepEqual(fact.sources.map((source) => [source.label, source.kind, source.status]), [['Pièce 2, lettre', 'piece', 'failed']]);
  assert.deepEqual(model.others.map((source) => source.label), ['Article 1104']);
  assert.equal(human('date_de_la_mise_en_demeure = false'), 'date de la mise en demeure = Faux');
  assert.equal(human('inexecution_grave et delai_respecte'), 'inexécution grave et délai respecté');
  assert.equal(human('resolution_possible'), 'résolution possible');
});

test('writes the rule, then its projection, then its justification', () => {
  const model = reasoning(dot, [module], citations);
  const document = new JSDOM(reasoningText(model)).window.document;
  const card = document.querySelector('[data-card]');
  assert.equal(card.querySelector('.pmc-kind').textContent, 'Conclusion');
  assert.equal(card.querySelector('h3').textContent, 'Résolution possible');
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Article 1226\s*Code civil/);
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Le créancier peut, à ses risques et périls/);
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Mise en demeure/);
  assert.equal(card.querySelector('[data-part="projection"] .pmc-value').textContent, 'Oui');
  assert.match(card.querySelector('[data-part="justification"]').textContent, /Mise en demeure Oui/);
  assert.match(card.querySelector('[data-part="justification"]').textContent, /lettre-jean-dupont\.md/);
  const link = card.querySelector('[data-part="rule"] [data-open-reference]');
  assert.equal(link.getAttribute('data-target'), 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041472');
  assert.equal(link.getAttribute('data-origin'), module.chemin);
  assert.equal(link.getAttribute('data-id'), 'LEGIARTI000032041472');
  assert.match(document.body.textContent, /Autres sources citées/);
  const visible = document.cloneNode(true);
  visible.querySelectorAll('.pmc-native').forEach((detail) => detail.remove());
  assert.doesNotMatch(visible.body.textContent, /Étape|Niveau|catala|test_resolution|LEGIARTI000032041472/);
  const fact = new JSDOM(reasoningCard(model.steps[0], model)).window.document;
  assert.match(fact.body.textContent, /Citation non retrouvée dans la source/);
  assert.deepEqual(reasoningIssues(model).map((entry) => [entry.id, entry.title]), [[model.steps[0].id, 'Pièce 2, lettre']]);
});

test('draws one box per cited document and links the piece to the article it applies', () => {
  const model = reasoning(dot, [module], citations);
  const document = new JSDOM(reasoningGraph(model)).window.document;
  assert.equal(document.querySelector('.pmc-map').dataset.layout, 'graph');
  const article = document.querySelector('.pmc-graph [data-doc="LEGIARTI000032041472"]');
  const piece = document.querySelector('.pmc-graph [data-doc="/dossiers/exemple/pieces/lettre-jean-dupont.md"]');
  assert.equal(article.dataset.kind, 'article');
  assert.ok(article.hasAttribute('data-open-reference'));
  assert.equal(article.querySelector('strong').textContent, 'Article 1226');
  assert.match(article.dataset.quote, /résoudre le contrat/);
  assert.equal(piece.dataset.kind, 'piece');
  assert.equal(piece.querySelector('strong').textContent, 'Pièce 2, lettre');
  assert.match(piece.dataset.quote, /Société Exemple SAS est mise en demeure de livrer/);
  assert.equal(piece.dataset.citation, 'failed');
  assert.match(piece.title, /Mise en demeure/i);
  assert.ok(document.querySelector('[data-from="/dossiers/exemple/pieces/lettre-jean-dupont.md"][data-to="LEGIARTI000032041472"]'));
  assert.match(document.querySelector('.pmc-map-summary').textContent, /Une case par document cité/);
  assert.equal(document.querySelectorAll('[data-doc][data-kind="origin"]').length, 0);
  assert.match(document.querySelector('.pmc-graph-loose').textContent, /Article 1104/);
  assert.doesNotMatch(document.querySelector('.pmc-map').textContent, /https?:|\.\.\/|\.md/);
  const otherQuote = citations.map((citation) => ({ ...citation, quote: 'Autre passage fictif.', status: 'passed' }));
  const unchecked = reasoning(dot, [module], otherQuote);
  assert.equal(unchecked.steps.find((step) => step.kind === 'fact').sources[0].status, '');
  assert.equal(reasoningGraph(reasoning('digraph G {}')), '');
});

test('uses the native position of an input to connect its piece without Concerne', () => {
  const file = { nom: 'test_resolution.catala_fr', chemin: '/dossiers/exemple/.piecemaker/catala/resolution/test_resolution.catala_fr', contenu: '> Usage de Resolution\n\n## Pièce fictive de réception\n[Pièce 2](../../../pieces/reception-fictive.md)\nCitation : « La demande a été reçue. »\n\n```catala\nchamp d\'application Scenario:\n  définition donnée égal à vrai\n```\n' };
  const homonym = { ...file, nom: 'autre/test_resolution.catala_fr', chemin: file.chemin.replace('/test_resolution', '/autre/test_resolution'), contenu: file.contenu.replace('reception-fictive.md', 'autre-piece-fictive.md') };
  const model = reasoning(dot.replace('test_resolution.catala_fr#L8', 'test_resolution.catala_fr#L9').replace('style="filled"];', 'tooltip="Pièce fictive de réception&#10;", style="filled"];'), [module, file, homonym]);
  const fact = model.steps.find((step) => step.kind === 'fact');
  assert.equal(fact.sources[0].target, '../../../pieces/reception-fictive.md');
  assert.match(fact.origins[0].headings.join(' '), /Pièce fictive de réception/);
  const graph = new JSDOM(reasoningGraph(model)).window.document;
  assert.ok(graph.querySelector('[data-doc][data-target="../../../pieces/reception-fictive.md"]'));
  assert.equal(graph.querySelectorAll('[data-doc][data-kind="origin"]').length, 0);
  assert.match(reasoningCard(fact, model), /reception-fictive\.md/);
});

test('builds a graph from native JSON when DOT is unavailable and preserves the applied rule and its exception', () => {
  const position = (line, heading) => ({ file: module.chemin, start: { line, character: 3 }, end: { line, character: 30 }, law_headings: [heading] });
  const rulePosition = (pos) => ({ filename: pos.file, start_line: pos.start.line, start_column: pos.start.character, end_line: pos.end.line, end_column: pos.end.character, law_headings: pos.law_headings });
  const base = position(16, 'Article 1226 du code civil');
  const exception = position(17, 'Exception fictive');
  const provenance = {
    trace: [{ element: { kind: 'scope_call', name: 'RésolutionUnilatérale', decl_pos: base }, pos: base, value: {}, trace: [
      { element: { kind: 'scope_var', name: 'mise_en_demeure', input: 'only_input', decl_pos: base }, pos: base, value: true },
      { element: { kind: 'scope_var', name: 'résolution_possible', output: true, decl_pos: base }, pos: base, value: false, trace: [{ element: { kind: 'exception' }, pos: exception, value: true }] },
    ] }],
    definitions: [{ fichier: module.chemin, scope: 'RésolutionUnilatérale', variable: 'résolution_possible', trees: [{ label: 'principe', rules: [{ pos: rulePosition(base) }], exceptions: [{ label: 'exception', rules: [{ pos: rulePosition(exception), condition_pos: rulePosition(exception), condition_text: 'mise_en_demeure' }], exceptions: [] }] }] }],
    dependencies: [{ fichier: module.chemin, intra_scopes: { RésolutionUnilatérale: { nodes: { 1: 'mise_en_demeure', 2: 'résolution_possible' }, edges: [{ from: 1, to: 2 }] } } }],
    issues: [],
  };
  const model = reasoning('digraph G {}', [module], [], undefined, provenance);
  const answer = model.steps.find((step) => step.answer);
  assert.equal(answer.value, 'Faux');
  assert.equal(answer.parents.length, 1);
  assert.ok(answer.origins.some((origin) => origin.label === 'principe' && !origin.selected));
  assert.ok(answer.origins.some((origin) => origin.label === 'exception' && origin.selected));
  const graph = new JSDOM(reasoningGraph(model)).window.document;
  const piece = graph.querySelector('[data-doc][data-kind="piece"]');
  assert.match(piece.dataset.quote, /Société Exemple SAS est mise en demeure de livrer/);
  assert.doesNotMatch(graph.querySelector('.pmc-map').textContent, /Origine native|colonne|Autre définition/);
  assert.match(reasoningCard(answer, model), /appliquée au scénario/);
  assert.match(reasoningCard(answer, model), /autre règle/);
});

test('distinguishes statutes, case law and other references without treating a website as legal authority', () => {
  const file = { ...module, contenu: `${module.contenu}\n## Sources\nConcerne : résolution_possible\n[Décision fictive](https://www.legifrance.gouv.fr/juri/id/JURITEXT000000000001)\n[Documentation](https://example.org/explication)\n` };
  const graph = new JSDOM(reasoningGraph(reasoning(dot, [file], citations))).window.document;
  assert.ok(graph.querySelector('[data-doc][data-kind="article"]'));
  assert.match(graph.querySelector('[data-doc][data-kind="jurisprudence"]').textContent, /Décision fictive/);
  assert.equal(graph.querySelectorAll('[data-doc][data-kind="reference"]').length, 0);
  assert.match(graph.querySelector('.pmc-unused').textContent, /1 référence à enregistrer dans le dossier.*Documentation/);
  const webOnly = { ...module, contenu: '## Sources\nConcerne : résolution_possible\n[Documentation](https://example.org/explication)\n' };
  assert.match(reasoning(dot, [webOnly]).steps.find((step) => step.kind === 'rule').issue, /Aucun article ni aucune décision/);
});

test('shares supporting nodes and preserves authored questions, research and native test coverage', () => {
  const file = { ...module, contenu: `${module.contenu}\n## Question\nConcerne : résolution_possible\nQuestion : Peut-on retenir cette solution ?\nJustification : La demande dépend de la condition indiquée.\nÀ rechercher : Obtenir la preuve de réception.\nDémarche : 2026-11-08 | demande de pièce | vérifier la réception | réponse attendue\n` };
  const coverage = { scopes: [{ index: 0, name: 'AvecDemande' }, { index: 1, name: 'SansDemande' }], locations: [{ file: file.chemin, tree: [{ range: { start: { line: 15 }, end: { line: 15 } }, reached_by: [0, 1], subtree: [] }] }] };
  const model = reasoning(dot.replace('  x002 -> x003', '  x004 [label=<<table><tr><td>autre_solution</td></tr><tr><td>mise_en_demeure</td></tr><tr><td>= true</td></tr></table>>];\n  x001 -> x004 [style="solid"];\n  x002 -> x003'), [file], citations, coverage);
  const graph = new JSDOM(reasoningGraph(model)).window.document;
  assert.equal(graph.querySelectorAll('[data-doc="/dossiers/exemple/pieces/lettre-jean-dupont.md"]').length, 1);
  assert.equal(graph.querySelectorAll('[data-doc="LEGIARTI000032041472"]').length, 1);
  const card = new JSDOM(reasoningCard(model.steps.find((step) => step.id === 'x002'), model)).window.document;
  assert.match(card.body.textContent, /Démarches effectuées.*réponse attendue/s);
  assert.match(card.body.textContent, /AvecDemande, SansDemande/);
});

test('keeps unknown and disputed facts open without changing their scenario values', () => {
  for (const [value, issue] of [['Inconnu ()', /non établi/], ['Contesté ()', /contesté/]]) {
    const model = reasoning(dot.replace('<td>true</td>', `<td>${value}</td>`), [module], citations);
    const fact = model.steps.find((step) => step.kind === 'fact');
    assert.equal(fact.value, value);
    assert.match(fact.issue, issue);
    assert.equal(new JSDOM(reasoningGraph(model)).window.document.querySelectorAll('[data-doc]').length, 3);
  }
});

test('flags a rule without legal basis and escapes trace text', () => {
  const model = reasoning(`digraph G {
    x001 [label=<<table><tr><td>&lt;img src=x onerror=alert(1)&gt;</td></tr><tr><td>=</td></tr><tr><td>false</td></tr></table>>, URL="https://catala.local/autre.catala_fr#L3"];
  }`);
  assert.equal(model.steps[0].issue, 'Aucun article ni aucune décision rattaché à cette règle.');
  const document = new JSDOM(reasoningText(model) + reasoningGraph(model)).window.document;
  assert.equal(document.querySelectorAll('img, script, [onerror]').length, 0);
  assert.throws(() => reasoning('digraph G { x001 [label=<a>]; x002 [label=<b>]; x001 -> x002 [style="solid"]; x002 -> x001 [style="solid"]; }'), /cycle/);
});

test('follows the depth of the Catala rules and separates exceptions', () => {
  const model = reasoning(`digraph G {
    x001 [label=<<table><tr><td>inexécution</td><td>true</td></tr></table>>, style="filled"];
    x002 [label=<<table><tr><td>force_majeure</td><td>false</td></tr></table>>, style="filled"];
    x003 [label=<<table><tr><td>inexecution_grave</td></tr><tr><td>inexécution</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>];
    x004 [label=<<table><tr><td>résolution_possible</td></tr><tr><td>inexécution_grave et non force_majeure</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>];
    subgraph cluster_inputs { x001; x002; }
    x001 -> x003 [style="solid"];
    x003 -> x004 [style="solid"];
    x002 -> x004 [style="solid"];
  }`);
  assert.equal(reasoningGraph(model), '');
  const card = new JSDOM(reasoningText(model)).window.document.querySelector('[data-card="x004"]');
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Non\s*Force majeure/);
  assert.match(card.querySelector('[data-part="projection"]').textContent, /Les conditions sont remplies/);
});

test('preserves a conditional dependency without claiming that a dashed link proves an exception', () => {
  const model = reasoning(`digraph G {
    x009 [label=<<table><tr><td colspan="2">Demo.Resolution</td></tr><tr><td>resolution_possible</td><td>false</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L9", shape=plaintext];
    x010 [label=<<table><tr><td><b>resolution_possible</b></td></tr><tr><td><b>= false</b></td></tr></table>>, URL="https://catala.local/demo.catala_fr#L31", style="filled"];
    x011 [label=<<table><tr><td><b>force_majeure</b></td></tr><tr><td><b>= true</b></td></tr></table>>, URL="https://catala.local/test_demo.catala_fr#L13", style="filled"];
    subgraph cluster_inputs { x011; }
    x010 -> x009 [style="solid"];
    x011 -> x010 [style="dashed", color="#FF7700"];
  }`);
  assert.equal(model.steps.find((step) => step.kind === 'rule').conditional, true);
  const document = new JSDOM(reasoningText(model)).window.document;
  const card = document.querySelector('[data-card="x010"]');
  assert.match(card.querySelector('[data-part="rule"]').textContent, /condition d’application/);
  assert.match(card.querySelector('[data-part="projection"]').textContent, /Non/);
  assert.match(card.querySelector('[data-part="justification"]').textContent, /Force majeure Oui/);
});

test('uses the native doc and its quote in the qualification card without mixing nearby sources', () => {
  const content = [
    '# Autre article | LEGIARTI000000000009',
    '```catala',
    "champ d'application Attribution:",
    '  #[doc="source: ../../../pieces/presence-fictive.md\\nquote: « Jean Dupont a participé à quatre séances. »"]',
    '  définition séances_constatées égal à 4',
    '  #[doc="source: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001\\nquote: « La participation doit atteindre trois séances. »"]',
    '  définition participation_suffisante égal à séances_constatées >= 3',
    '  définition prime_due égal à participation_suffisante',
    '```',
    '## Références',
    '[Article 1 du règlement fictif](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001)',
  ].join('\n');
  const model = reasoning(`digraph G {
    x001 [label=<<table><tr><td>séances_constatées</td><td>4</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L5"];
    x002 [label=<<table><tr><td>participation_suffisante</td></tr><tr><td>séances_constatées &gt;= 3</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L7"];
    x003 [label=<<table><tr><td>prime_due</td></tr><tr><td>participation_suffisante</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L8"];
    x001 -> x002 [style="solid"];
    x002 -> x003 [style="solid"];
  }`, [{ nom: 'demo.catala_fr', chemin: '/dossier/demo.catala_fr', contenu: content }]);
  assert.equal(model.steps.find((step) => step.id === 'x001').kind, 'fact');
  const document = new JSDOM(reasoningGraph(model)).window.document;
  const article = document.querySelector('[data-doc="LEGIARTI000000000001"]');
  const piece = document.querySelector('[data-doc="/pieces/presence-fictive.md"]');
  assert.match(article.dataset.quote, /trois séances/);
  assert.match(piece.dataset.quote, /quatre séances/);
  assert.equal(document.querySelectorAll('[data-from="/pieces/presence-fictive.md"][data-to="LEGIARTI000000000009"]').length, 0);
  assert.ok(document.querySelector('[data-from="/pieces/presence-fictive.md"][data-to="LEGIARTI000000000001"]'));
  assert.equal(document.querySelectorAll('a').length, 0);
  assert.doesNotMatch(document.querySelector('.pmc-map').textContent, /https?:|\.\.\/|\.md/);
  assert.equal(piece.tagName, 'BUTTON');
  assert.equal(piece.getAttribute('type'), 'button');
  assert.equal(piece.querySelector('strong').textContent, 'Presence fictive');
  assert.ok(!piece.title.includes('http'));
  assert.equal(article.querySelector('strong').textContent, 'Article 1 du règlement fictif');
});
