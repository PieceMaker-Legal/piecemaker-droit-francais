const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'herisson.mjs')).href);
const loadFeatures = () => import(pathToFileURL(path.join(__dirname, 'lib', 'herisson.mjs')).href);
const root = path.resolve('/dossiers/dossier-exemple');

function fakePm(stdout = '') {
  const calls = [];
  return { calls, run: async (args, cwd, timeoutMs) => { calls.push({ args: args.join(' '), cwd, timeoutMs }); return { code: 0, stdout, stderr: '' }; } };
}

test('le registre classe chaque fichier dans sa feature', async () => {
  const { featureOf } = await loadFeatures();
  const of = (relative) => featureOf(path.join(root, '.piecemaker', relative));
  assert.equal(of('okf/pieces/a.md').feature.nom, 'okf');
  assert.equal(of('arborescence.json').feature.nom, 'arborescence');
  assert.equal(of('raisonnements/indemnite.yaml'), null);
  assert.deepEqual([of('appel-suivi.json').feature.nom, of('appel-suivi.json').nom], ['suivi', 'appel-suivi.json']);
  assert.deepEqual([of('catala/indemnite/indemnite.catala_fr').feature.nom, of('catala/indemnite/indemnite.catala_fr').nom], ['catala', 'indemnite']);
  assert.equal(of('catala/indemnite/_build/x.catala_fr'), null);
  assert.equal(of('protection.json'), null);
  assert.equal(featureOf(path.join(root, 'pieces', 'a.md')), null);
  assert.equal(featureOf(path.join(root, '.piecemaker', 'okf')).feature.nom, 'okf');
});

test('une écriture de suivi lance son vérificateur et rend le résultat à l’agent', async () => {
  const { featureReport } = await load();
  const pm = fakePm('appel-suivi.json\n  échéance sans source');
  const report = await featureReport({ tool_name: 'Write', cwd: root, tool_input: { file_path: '.piecemaker/appel-suivi.json' } }, { run: pm.run });
  assert.deepEqual(pm.calls, [{ args: `suivi_dossiers verifier --suivi appel-suivi.json --dossier ${root}`, cwd: root, timeoutMs: 60000 }]);
  assert.match(report.hookSpecificOutput.additionalContext, /Vérification automatique \(suivi\)[\s\S]*échéance sans source/);
});

test('une écriture de mémoire projet lance pm memoire verifier', async () => {
  const { featureReport } = await load();
  const { featureOf } = await loadFeatures();
  assert.equal(featureOf(path.join(root, '.piecemaker', 'memoires', 'sous', 'appel.md')), null);
  const pm = fakePm('.piecemaker/memoires/appel.md:1: erreur : pas de frontmatter.');
  const report = await featureReport({ tool_name: 'Edit', cwd: root, tool_input: { file_path: '.piecemaker/memoires/appel.md' } }, { run: pm.run });
  assert.deepEqual(pm.calls, [{ args: `memoire verifier --memoire appel --dossier ${root}`, cwd: root, timeoutMs: 10000 }]);
  assert.match(report.hookSpecificOutput.additionalContext, /Vérification automatique \(memoire\)[\s\S]*pas de frontmatter/);
});

test('un apply_patch Codex vérifie chaque feature touchée une seule fois', async () => {
  const { featureReport } = await load();
  const pm = fakePm('Programme indemnite : à corriger.');
  const patch = ['*** Begin Patch', '*** Update File: .piecemaker/catala/indemnite/indemnite.catala_fr', '*** Add File: .piecemaker/catala/indemnite/clerk.toml', '*** Update File: .piecemaker/appel-suivi.json', '*** End Patch'].join('\n');
  await featureReport({ tool_name: 'apply_patch', cwd: root, tool_input: { command: patch } }, { run: pm.run });
  assert.deepEqual(pm.calls.map((call) => call.args), [`catala verifier --programme indemnite --dossier ${root}`, `suivi_dossiers verifier --suivi appel-suivi.json --dossier ${root}`]);
});

test('rien à vérifier hors des features écrites par l’agent', async () => {
  const { featureReport } = await load();
  const pm = fakePm('ignoré');
  for (const file_path of ['pieces/note.md', '.piecemaker/raisonnements/indemnite.yaml', '.piecemaker/okf/pieces/a.md', '.piecemaker/arborescence.json']) {
    assert.equal(await featureReport({ tool_name: 'Edit', cwd: root, tool_input: { file_path } }, { run: pm.run }), null);
  }
  assert.equal(await featureReport({ tool_name: 'Bash', cwd: root, tool_input: { command: 'cat .piecemaker/appel-suivi.json' } }, { run: pm.run }), null);
  assert.deepEqual(pm.calls, []);
});

test('Vibe : le chemin passé dans path est reconnu', async () => {
  const { touchedFiles } = await load();
  assert.deepEqual(touchedFiles({ tool_name: 'Write', cwd: root, tool_input: { path: '.piecemaker/suivi.json' } }), [path.join(root, '.piecemaker', 'suivi.json')]);
});

test('la garde refuse, avant l’écriture, un programme Catala hors format', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { hookDecision } = await import(pathToFileURL(path.join(__dirname, 'guard-ontologie.mjs')).href);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'herisson-format-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  const file_path = '.piecemaker/catala/indemnite/indemnite.catala_fr';
  const absolute = path.join(dossier, file_path);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const section = (n) => `## Article ${n} | LEGIARTI00000000000${n}\n\n« Texte fictif ${n}. »\n`;
  const valid = `${section(1)}\n${section(2)}`;
  const grouped = `# Sources\n\n[Article 2](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000002)\n\n${valid}`;
  const reason = async (tool_name, tool_input) => (await hookDecision({ cwd: dossier, tool_name, tool_input }, async () => ({ code: 0, stdout: '', stderr: '' })))?.hookSpecificOutput.permissionDecisionReason ?? null;
  fs.writeFileSync(absolute, valid);
  assert.match(await reason('Write', { file_path, content: grouped }), /Hérisson[\s\S]*indemnite\.catala_fr:3: LEGIARTI000000000002 cité hors de sa section/);
  assert.match(await reason('Write', { file_path, content: '## Articles 1 et 2 | LEGIARTI000000000001 | LEGIARTI000000000002\n\n« Texte fictif. »\n' }), /une section = une source/);
  assert.match(await reason('Edit', { file_path, old_string: '« Texte fictif 1. »', new_string: '« Texte fictif 1. » Voir LEGIARTI000000000002.' }), /cité hors de sa section/);
  assert.match(await reason('apply_patch', { command: `*** Begin Patch\n*** Update File: ${file_path}\n@@\n ## Article 1 | LEGIARTI000000000001\n+Voir LEGIARTI000000000002.\n*** End Patch` }), /cité hors de sa section/);
  assert.equal(await reason('Write', { file_path, content: valid }), null);
  assert.equal(await reason('Write', { file_path: 'notes/sources.md', content: grouped }), null);
  fs.writeFileSync(absolute, grouped);
  assert.equal(await reason('Edit', { file_path, old_string: '« Texte fictif 1. »', new_string: '« Texte fictif 1 corrigé. »' }), null);
});

test('une commande pm okf link vérifie l’index, et les programmes Catala qui citent une prémisse', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { featureReport } = await load();
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'herisson-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  for (const [nom, contenu] of [['cite', '## okf:/_premises/date-de-depart.md\n'], ['autre', '## Article 1 | LEGIARTI000000000001\n']]) {
    fs.mkdirSync(path.join(dossier, '.piecemaker', 'catala', nom), { recursive: true });
    fs.writeFileSync(path.join(dossier, '.piecemaker', 'catala', nom, `${nom}.catala_fr`), contenu);
  }
  const link = (command) => { const pm = fakePm('Index OKF : 0 erreur(s).'); return featureReport({ tool_name: 'Bash', cwd: dossier, tool_input: { command } }, { run: pm.run }).then(() => pm.calls.map((call) => call.args)); };
  assert.deepEqual(await link('pm okf link pieces/a.md states "Date de départ" --citation "Texte fictif."'), [`okf verify --dossier ${dossier}`, `catala verifier --programme cite --dossier ${dossier}`]);
  assert.deepEqual(await link('pm okf link pieces/a.md amends pieces/b.md --citation "Texte fictif."'), [`okf verify --dossier ${dossier}`]);
  assert.deepEqual(await link('pm okf verify'), []);
});

test('une commande pm tabular_review preparer ou lancer vérifie le brouillon', async () => {
  const { featureReport } = await load();
  const dossier = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'herisson-'));
  require('node:fs').mkdirSync(path.join(dossier, '.piecemaker'));
  const review = (command) => { const pm = fakePm('Recherche « Rupture fictive » : bloquée'); return featureReport({ tool_name: 'Bash', cwd: dossier, tool_input: { command } }, { run: pm.run }).then((report) => ({ calls: pm.calls.map((call) => call.args), report })); };
  const prepared = await review('pm tabular_review preparer --mode recherche --nom "Rupture fictive"');
  assert.deepEqual(prepared.calls, [`tabular_review verifier --dossier ${dossier}`]);
  assert.match(prepared.report.hookSpecificOutput.additionalContext, /Vérification automatique \(revue\) : pm tabular_review verifier/);
  assert.deepEqual((await review('pm tabular_review lancer --projet p1')).calls, [`tabular_review verifier --dossier ${dossier}`]);
  assert.deepEqual((await review('pm tabular_review lister')).calls, []);
});
