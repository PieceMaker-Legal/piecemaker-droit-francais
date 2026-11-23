const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'herisson.mjs')).href);
const loadFeatures = () => import(pathToFileURL(path.join(__dirname, 'lib', 'herisson.mjs')).href);
const root = path.resolve('/dossiers/dossier-exemple');
process.env.PIECEMAKER_HERISSON_ETAT = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'herisson-etat-'));
process.env.PIECEMAKER_HOME = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'herisson-home-'));
const TEST_BRAIN = path.join(process.env.PIECEMAKER_HOME, 'brain');
require('node:fs').writeFileSync(path.join(process.env.PIECEMAKER_HOME, 'brain.json'), JSON.stringify({ path: TEST_BRAIN }));
test.after(() => { require('node:fs').rmSync(process.env.PIECEMAKER_HERISSON_ETAT, { recursive: true, force: true }); require('node:fs').rmSync(process.env.PIECEMAKER_HOME, { recursive: true, force: true }); });

function fakePm(stdout = '') {
  const calls = [];
  return { calls, run: async (args, cwd, timeoutMs) => { calls.push({ args: args.join(' '), cwd, timeoutMs }); return { code: 0, stdout, stderr: '' }; } };
}

test('le registre classe chaque fichier dans sa feature', async () => {
  const { featureOf } = await loadFeatures();
  const of = (relative) => featureOf(path.join(root, '.piecemaker', relative));
  assert.equal(of('okf/pieces/a.md').feature.nom, 'okf');
  assert.equal(of('arborescence.json'), null);
  assert.equal(of('notes/indemnite.md'), null);
  assert.deepEqual([of('appel-suivi.json').feature.nom, of('appel-suivi.json').nom], ['suivi', 'appel-suivi.json']);
  assert.deepEqual([of('catala/indemnite/indemnite.catala_fr').feature.nom, of('catala/indemnite/indemnite.catala_fr').nom], ['catala', 'indemnite']);
  assert.equal(of('catala/indemnite/_build/x.catala_fr'), null);
  assert.deepEqual(['protection.json', 'etapes.json', 'ontologie.proposition.json'].map((file) => of(file).feature.nom), ['protection', 'etapes', 'ontologie']);
  assert.equal(of('modeles.json'), null);
  assert.equal(featureOf(path.join(root, 'pieces', 'a.md')), null);
  assert.equal(featureOf(path.join(root, '.piecemaker', 'okf')).feature.nom, 'okf');
});

test('une écriture de suivi lance son vérificateur et rend le résultat à l’agent', async () => {
  const { featureReport } = await load();
  const pm = fakePm('appel-suivi.json\n  échéance sans source');
  const report = await featureReport({ tool_name: 'Write', cwd: root, tool_input: { file_path: '.piecemaker/appel-suivi.json' } }, { run: pm.run });
  assert.deepEqual(pm.calls, [{ args: `suivi_dossiers verifier --suivi appel-suivi.json --dossier ${root}`, cwd: root, timeoutMs: 60000 }]);
  assert.match(report.hookSpecificOutput.additionalContext, /Automatic check \(suivi\)[\s\S]*échéance sans source/);
});

test('une écriture de mémoire projet lance pm memoire verifier', async () => {
  const { featureReport } = await load();
  const { featureOf } = await loadFeatures();
  assert.equal(featureOf(path.join(root, '.piecemaker', 'memoires', 'sous', 'appel.md')), null);
  const pm = fakePm('.piecemaker/memoires/appel.md:1: erreur : pas de frontmatter.');
  const report = await featureReport({ tool_name: 'Edit', cwd: root, tool_input: { file_path: '.piecemaker/memoires/appel.md' } }, { run: pm.run });
  assert.deepEqual(pm.calls, [{ args: `memoire verifier --memoire appel --dossier ${root}`, cwd: root, timeoutMs: 10000 }]);
  assert.match(report.hookSpecificOutput.additionalContext, /Automatic check \(memoire\)[\s\S]*pas de frontmatter/);
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
  for (const file_path of ['pieces/note.md', '.piecemaker/notes/indemnite.md', '.piecemaker/arborescence.json']) {
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

test('la garde refuse une erreur de compilation nouvelle, garde les erreurs déjà présentes et laisse passer sans pack', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { hookDecision } = await import(pathToFileURL(path.join(__dirname, 'guard-ontologie.mjs')).href);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'herisson-compilation-'));
  const previous = process.env.PIECEMAKER_COMPONENTS_HOME;
  t.after(() => {
    if (previous === undefined) delete process.env.PIECEMAKER_COMPONENTS_HOME;
    else process.env.PIECEMAKER_COMPONENTS_HOME = previous;
    fs.rmSync(dossier, { recursive: true, force: true });
  });
  const bin = path.join(dossier, 'pack', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'catala'), '');
  fs.writeFileSync(path.join(bin, 'clerk'), `#!${process.execPath}\nconst fs = require('node:fs');\nconst errors = fs.readdirSync('.').filter((file) => file.endsWith('.catala_fr')).flatMap((file) => fs.readFileSync(file, 'utf8').split('\\n').flatMap((line, index) => (line.match(/inconnu_\\w+/g) || []).map((word) => \`\${file}:\${index + 1}.1-5: [ERROR] Unknown identifier \${word}\`)));\nconsole.log(errors.join('\\n'));\nprocess.exit(errors.length ? 123 : 0);\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(dossier, 'pack', 'catala'));
  fs.writeFileSync(path.join(dossier, 'pack', 'catala', 'pack.json'), JSON.stringify({ bin: { catala: path.join(bin, 'catala'), clerk: path.join(bin, 'clerk') }, path: [bin] }));
  const directory = path.join(dossier, '.piecemaker', 'catala', 'prime');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'clerk.toml'), '[project]\nname = "prime"\n');
  fs.writeFileSync(path.join(directory, 'prime.catala_fr'), '> Module Prime\n');
  fs.writeFileSync(path.join(directory, 'autre.catala_fr'), '> Module Autre\n\ninconnu_ancien\n');
  const file_path = '.piecemaker/catala/prime/prime.catala_fr';
  const reason = async (content) => (await hookDecision({ cwd: dossier, tool_name: 'Write', tool_input: { file_path, content } }, async () => ({ code: 0, stdout: '', stderr: '' })))?.hookSpecificOutput.permissionDecisionReason ?? null;
  process.env.PIECEMAKER_COMPONENTS_HOME = path.join(dossier, 'pack');
  assert.equal(await reason('> Module Prime\n\nTexte fictif.\n'), null);
  assert.equal(await reason('> Module Prime\n\ninconnu_nouveau\n'), 'Write refused by Le Hérisson: the program does not follow the Catala format or does not compile. Nothing was written.\nprime.catala_fr:3: compilation: Unknown identifier inconnu_nouveau\n    line 3 is: inconnu_nouveau\nCorrect only the lines shown, keep the rest of the file, then write again. Start from the model of references/format.md (Feature read catala path=catala/references/format.md), which compiles; its table "Fautes fréquentes" gives the fix of common errors.');
  fs.writeFileSync(path.join(directory, 'prime.catala_fr'), '> Module Prime\n\ninconnu_present\n');
  assert.equal(await reason('> Module Prime\n\nTexte.\n\ninconnu_present\n'), null);
  process.env.PIECEMAKER_COMPONENTS_HOME = path.join(dossier, 'absent');
  assert.equal(await reason('> Module Prime\n\ninconnu_nouveau\n'), null);
});

test('la garde refuse un nouveau programme Catala dont le nom n’est pas un raisonnement du dossier', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { hookDecision } = await import(pathToFileURL(path.join(__dirname, 'guard-ontologie.mjs')).href);
  const dossier = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'herisson-nom-')));
  const previous = process.env.PIECEMAKER_COMPONENTS_HOME;
  t.after(() => {
    if (previous === undefined) delete process.env.PIECEMAKER_COMPONENTS_HOME;
    else process.env.PIECEMAKER_COMPONENTS_HOME = previous;
    fs.rmSync(dossier, { recursive: true, force: true });
  });
  process.env.PIECEMAKER_COMPONENTS_HOME = path.join(dossier, 'absent');
  fs.mkdirSync(path.join(dossier, '.piecemaker', 'catala', 'vieux'), { recursive: true });
  fs.writeFileSync(path.join(dossier, '.piecemaker', 'catala', 'vieux', 'vieux.catala_fr'), '> Module Vieux\n');
  const reason = async (nom) => (await hookDecision({ cwd: dossier, tool_name: 'Write', tool_input: { file_path: `.piecemaker/catala/${nom}/clerk.toml`, content: `[project]\nname = "${nom}"\n` } }, async () => ({ code: 0, stdout: '', stderr: '' })))?.hookSpecificOutput.permissionDecisionReason ?? null;
  assert.equal(await reason('indem'), null);
  const { caseDirectory } = await import(pathToFileURL(path.join(__dirname, 'lib', 'brain-case.mjs')).href);
  const goal = path.join(caseDirectory(dossier, { create: true }).goals, 'licenciement');
  fs.mkdirSync(goal, { recursive: true });
  fs.writeFileSync(path.join(goal, 'Timeline.json'), JSON.stringify({ actes: { 'indemnite-licenciement': { etape: 'raisonnement' }, ancien: { etape: 'raisonnement', remplacePar: 'indemnite-licenciement' } } }));
  assert.match(await reason('indem'), /clerk\.toml:1: program name "indem" is not a reasoning of the case\. Use the exact name given by pm check: \.piecemaker\/catala\/indemnite-licenciement\/\./);
  assert.match(await reason('ancien'), /program name "ancien"/);
  assert.equal(await reason('indemnite-licenciement'), null);
  assert.equal(await reason('vieux'), null);
});

test('une commande pm okf link vérifie l’index, sans relancer les programmes Catala', async (t) => {
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
  assert.deepEqual(await link('pm okf link pieces/a.md states "Date de départ" --citation "Texte fictif."'), [`okf verify --dossier ${dossier}`]);
  assert.deepEqual(await link('pm okf link pieces/a.md amends pieces/b.md --citation "Texte fictif."'), [`okf verify --dossier ${dossier}`]);
  assert.deepEqual(await link('pm okf verify'), []);
});

test('un appel MCP Feature run déclenche le même contrôle que la commande pm', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { featureReport } = await load();
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'herisson-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dossier, '.piecemaker'));
  const call = (tool_input, tool_name = 'mcp__features__Feature') => { const pm = fakePm('Index OKF : 0 erreur(s).'); return featureReport({ tool_name, cwd: dossier, tool_input }, { run: pm.run }).then(() => pm.calls.map((entry) => entry.args)); };
  const link = { action: 'run', name: 'index', command: 'link', args: { source: 'pieces/a.md', relation: 'amends', target: 'pieces/b.md', citation: 'Texte fictif.' } };
  assert.deepEqual(await call(link), [`okf verify --dossier ${dossier}`]);
  assert.deepEqual(await call({ ...link, action: 'read' }), []);
  assert.deepEqual(await call({ action: 'run', name: 'index', command: 'verify_index' }), []);
  assert.deepEqual(await call(link, 'mcp__autre__Feature'), []);
  assert.deepEqual(await call({ writes: [{ action: 'link', ...link.args }, { action: 'mark_examined', source: 'pieces/a.md', reason: 'Aucun lien' }] }, 'mcp__features__OkfWrite'), [`okf verify --dossier ${dossier}`]);
  assert.deepEqual(await call({ writes: [{ action: 'mark_examined', source: 'pieces/a.md', reason: 'Aucun lien' }] }, 'mcp__features__OkfWrite'), [`okf verify --dossier ${dossier}`]);
});

test('une commande pm tabular_review preparer ou lancer vérifie le brouillon', async () => {
  const { featureReport } = await load();
  const dossier = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'herisson-'));
  require('node:fs').mkdirSync(path.join(dossier, '.piecemaker'));
  const review = (command) => { const pm = fakePm('Recherche « Rupture fictive » : bloquée'); return featureReport({ tool_name: 'Bash', cwd: dossier, tool_input: { command } }, { run: pm.run }).then((report) => ({ calls: pm.calls.map((call) => call.args), report })); };
  const prepared = await review('pm tabular_review preparer --mode recherche --nom "Rupture fictive"');
  assert.deepEqual(prepared.calls, [`tabular_review verifier --dossier ${dossier}`]);
  assert.match(prepared.report.hookSpecificOutput.additionalContext, /Automatic check \(revue\): pm tabular_review verifier/);
  assert.deepEqual((await review('pm tabular_review lancer --projet p1')).calls, [`tabular_review verifier --dossier ${dossier}`]);
  assert.deepEqual((await review('pm tabular_review lister')).calls, []);
});

test('un rapport déjà rendu n’est pas répété : seuls les blocs nouveaux reviennent', async () => {
  const { featureReport } = await load();
  const dossier = path.resolve('/dossiers/dossier-delta');
  const write = (stdout) => featureReport({ tool_name: 'Write', cwd: dossier, tool_input: { file_path: '.piecemaker/bail-suivi.json' } }, { run: fakePm(stdout).run }).then((report) => report?.hookSpecificOutput.additionalContext ?? null);
  const first = ['Échéances :', '  Congé : 2027-03-31', '1 erreur(s), 0 manque(s).', 'Erreur 1 — echeances.Congé.source (ligne 12)', '  source absente'].join('\n');
  assert.match(await write(first), /Erreur 1 — echeances\.Congé\.source \(ligne 12\)\n  source absente\n\nCorrect each error or gap in the file and at the line shown\. Do not run this verifier yourself/);
  assert.equal(await write(first), null);
  const second = ['Échéances :', '  Congé : 2027-03-31', '2 erreur(s), 0 manque(s).', 'Erreur 1 — evenements.Bail.piece (ligne 4)', '  pièce introuvable', 'Erreur 2 — echeances.Congé.source (ligne 14)', '  source absente'].join('\n');
  assert.equal(await write(second), ['Automatic check (suivi): pm suivi_dossiers verifier --suivi bail-suivi.json', '2 erreur(s), 0 manque(s).', 'Erreur 1 — evenements.Bail.piece (ligne 4)', '  pièce introuvable', '2 report item(s) were already shown above and did not change. They are not repeated. The items that report an error or a gap must still be corrected.', '', 'Correct each error or gap in the file and at the line shown. Do not run this verifier yourself: Le Hérisson runs it after each write and gives the full report at the end of the turn.'].join('\n'));
  const clean = await write('Échéances :\n  Congé : 2027-03-31\nAucune erreur, aucun manque.');
  assert.equal(clean, 'Automatic check (suivi): pm suivi_dossiers verifier --suivi bail-suivi.json\nAucune erreur, aucun manque.\n1 report item(s) were already shown above and did not change. They are not repeated.');
});

test('la fin de tour est suspendue une seule fois, avec le rapport complet des erreurs restantes', async () => {
  const { featureReport, turnEndReport } = await load();
  const dossier = path.resolve('/dossiers/dossier-fin-de-tour');
  const failed = '1 erreur(s), 0 manque(s).\nErreur 1 — echeances.Congé.source (ligne 12)\n  source absente';
  const write = (stdout) => featureReport({ tool_name: 'Write', cwd: dossier, tool_input: { file_path: '.piecemaker/bail-suivi.json' } }, { run: fakePm(stdout).run });
  const stop = (stdout, extra = {}) => { const pm = fakePm(stdout); return turnEndReport({ hook_event_name: 'Stop', cwd: dossier, ...extra }, { run: pm.run }).then((report) => ({ report, calls: pm.calls.map((call) => call.args) })); };
  assert.deepEqual(await stop(failed), { report: null, calls: [] });
  await write(failed);
  const blocked = await stop(failed);
  assert.deepEqual(blocked.calls, [`suivi_dossiers verifier --suivi bail-suivi.json --dossier ${dossier}`]);
  assert.equal(blocked.report.decision, 'block');
  assert.match(blocked.report.reason, /^End of turn stopped by Le Hérisson: 1 check\(s\) still report[\s\S]*Erreur 1 — echeances\.Congé\.source \(ligne 12\)\n  source absente\n\nCorrect each error[\s\S]*will not be stopped a second time\.$/);
  assert.equal((await stop(failed)).report, null);
  assert.deepEqual(await stop(failed), { report: null, calls: [] });
  await write(failed);
  assert.equal((await stop('Aucune erreur, aucun manque.')).report, null);
  await write(failed);
  assert.equal((await stop(failed, { stop_hook_active: true })).report, null);
  await write('Aucune erreur, aucun manque.');
  assert.deepEqual(await stop(failed), { report: null, calls: [] });
});

test('la fin de tour est suspendue une seule fois quand un sous-agent PieceMaker lancé n’a pas rendu son compte rendu', async () => {
  const { subagentTrack, turnEndReport } = await load();
  const dossier = path.resolve('/dossiers/dossier-sous-agents');
  const agent = (event, id, type) => subagentTrack({ hook_event_name: event, cwd: dossier, agent_id: id, agent_type: type });
  const stop = (extra = {}) => turnEndReport({ hook_event_name: 'Stop', cwd: dossier, ...extra }, { run: fakePm('').run });
  agent('SubagentStart', 'a1', 'research-maker');
  agent('SubagentStop', 'a1', 'research-maker');
  assert.equal(await stop(), null);
  agent('SubagentStart', 'a2', 'research-maker');
  agent('SubagentStart', 'a3', 'research-maker');
  agent('SubagentStop', 'a3', 'research-maker');
  const blocked = await stop();
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.reason, 'End of turn stopped by Le Hérisson: 1 PieceMaker subagent(s) started during this turn did not give their report (research-maker).\n\nDo the work that the lawyer asked for in this turn: wait for each report, or run the subagent again in the foreground and use its report. Do not schedule a wake-up and do not suspend the work. If the lawyer stopped a subagent, do not run it again. The end of turn will not be stopped a second time.');
  assert.equal(await stop(), null);
  assert.equal(await stop(), null);
  agent('SubagentStart', 'a4', 'research-maker');
  assert.equal(await stop({ stop_hook_active: true }), null);
  assert.equal(await stop(), null);
});

test('la garde refuse, avant l’écriture, un suivi ou une mémoire hors format', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { hookDecision } = await import(pathToFileURL(path.join(__dirname, 'guard-ontologie.mjs')).href);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'herisson-format-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  const reason = async (file_path, content) => (await hookDecision({ cwd: dossier, tool_name: 'Write', tool_input: { file_path, content } }, async () => ({ code: 0, stdout: '', stderr: '' })))?.hookSpecificOutput.permissionDecisionReason ?? null;
  assert.equal(await reason('.piecemaker/bail-suivi.json', '{\n  "matter": {},\n  "echeance": {},\n  "evenements": []\n}'), [
    'Write refused by Le Hérisson: the tracking file does not have the expected structure. Nothing was written.',
    'bail-suivi.json:3: unknown key "echeance" at the root of the tracking file. Permitted keys: matter, evenements, echeances. Move its content under one of them or remove it.',
    '    line 3 is: "echeance": {},',
    'bail-suivi.json:4: "evenements" must be an object { "name in French": {…} }, not a list.',
    '    line 4 is: "evenements": []',
    'Correct these lines, then write the file again. Full model: Feature read deadlines path=piecemaker/references/suivi.md.',
  ].join('\n'));
  assert.match(await reason('.piecemaker/bail-suivi.json', '{ "matter": {}, }'), /bail-suivi\.json:1: invalid JSON/);
  assert.equal(await reason('.piecemaker/bail-suivi.json', '{ "matter": {}, "evenements": {}, "echeances": {} }'), null);
  assert.match(await reason('.piecemaker/memoires/bail.md', '---\netape: redaction\n---\n# Bail\n'), /^Write refused by Le Hérisson: the project memory does not have the expected structure\. Nothing was written\.\nbail\.md:1: frontmatter is not permitted/);
  assert.equal(await reason('.piecemaker/memoires/bail.md', '# Bail\n\n---\n'), null);
});

test('la garde refuse d’écrire les étapes, la protection et une proposition en attente', async () => {
  const { hookDecision } = await import(pathToFileURL(path.join(__dirname, 'guard-ontologie.mjs')).href);
  const reason = async (tool_name, tool_input) => (await hookDecision({ cwd: root, tool_name, tool_input }, async () => ({ code: 0, stdout: '', stderr: '' })))?.hookSpecificOutput.permissionDecisionReason ?? null;
  assert.match(await reason('Write', { file_path: '.piecemaker/etapes.json', content: '{}' }), /Only the lawyer sets the case steps[\s\S]*pm check/);
  assert.match(await reason('Bash', { command: 'echo {} > .piecemaker/protection.json' }), /Only the lawyer removes the protection/);
  assert.match(await reason('Bash', { command: 'rm ~/.piecemaker/ontologie.proposition.json' }), /ontologie/);
  assert.match(await reason('Write', { file_path: '.piecemaker/ontologie.proposition.json', content: '{}' }), /ontologie/);
  assert.equal(await reason('Bash', { command: 'cat .piecemaker/etapes.json' }), null);
});

test('les fichiers goals/<goal>/ du brain se vérifient dans leur dossier, et l’agent ne touche ni aux actes ni au Timeline.json du dossier', async () => {
  const fs = require('node:fs');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'herisson-brain-')));
  const home = path.join(base, 'home');
  const brain = path.join(base, 'brain');
  const dossier = path.join(base, 'Dossier Dupont');
  const goal = path.join(brain, 'projects', 'Dossier Dupont', 'goals', 'appel');
  fs.mkdirSync(path.join(brain, '.piecemaker'), { recursive: true });
  fs.mkdirSync(goal, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'brain.json'), JSON.stringify({ path: brain }));
  fs.writeFileSync(path.join(brain, '.piecemaker', 'dossiers.json'), JSON.stringify({ [dossier]: 'Dossier Dupont' }));
  const timeline = path.join(goal, 'Timeline.json');
  fs.writeFileSync(timeline, JSON.stringify({ actes: { appel: { etape: 'redaction' } } }, null, 2));
  const previous = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = home;
  try {
    const { featureOf, formatErrors, verifierArgs } = await loadFeatures();
    assert.deepEqual([featureOf(timeline).feature.nom, featureOf(timeline).root], ['timeline', dossier]);
    assert.deepEqual(verifierArgs(featureOf(timeline)), ['suivi_dossiers', 'verifier', '--suivi', 'appel-suivi.json']);
    assert.equal(featureOf(path.join(goal, 'Memory.md')).feature.nom, 'goal');
    assert.match(featureOf(path.join(brain, 'projects', 'Dossier Dupont', 'Timeline.json')).feature.motif, /goals\/<goal>\/Timeline\.json/);
    assert.equal(featureOf(path.join(goal, 'Archive.md')), null);
    assert.equal(featureOf(path.join(brain, 'AGENTS.md')), null);
    const write = (value) => formatErrors('Write', { file_path: timeline, content: JSON.stringify(value, null, 2) }, dossier);
    const kept = { actes: { appel: { etape: 'redaction' } } };
    assert.equal(await write({ ...kept, echeances: {} }), null);
    assert.equal(await write({ actes: { ...kept.actes, 'conclusions': {} }, echeances: {} }), null);
    assert.match(await write({ actes: { appel: { etape: 'clos' } } }), /act "appel" cannot be changed by the agent/);
    assert.match(await write({ ...kept, notes: 'x' }), /unknown key "notes"/);
    assert.match(await formatErrors('Write', { file_path: path.join(goal, 'Goal.md'), content: 'x\n'.repeat(201) }, dossier), /the limit is 200[\s\S]*Archive\.md/);
  } finally {
    if (previous === undefined) delete process.env.PIECEMAKER_HOME; else process.env.PIECEMAKER_HOME = previous;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('le rapport d’un fil vérifie, selon les outils qu’il a utilisés, le travail rendu à l’agent central', async () => {
  const { workReport } = await load();
  const pm = fakePm('Suivi appel-suivi.json : 1 erreur(s), 0 manque(s).\nechéances.appel : délai non justifié');
  const calls = [
    { tool_name: 'Read', tool_input: { file_path: path.join(root, 'pieces', 'a.md') } },
    { tool_name: 'Write', tool_input: { file_path: '.piecemaker/appel-suivi.json', content: '{}' } },
    { tool_name: 'Edit', tool_input: { file_path: path.join(root, '.piecemaker', 'appel-suivi.json'), old_string: 'x', new_string: 'y' } },
  ];
  const report = await workReport(root, calls, { run: pm.run });
  assert.equal(pm.calls.length, 1);
  assert.equal(pm.calls[0].args, `suivi_dossiers verifier --suivi appel-suivi.json --dossier ${root}`);
  assert.match(report, /^Rapport hérisson \(1 check\(s\)/);
  assert.match(report, /délai non justifié/);
  assert.equal(await workReport(root, calls.slice(0, 1), { run: pm.run }), null);
  assert.match(await workReport(root, calls.slice(1, 2), { run: fakePm('').run }), /: valid$/);
});
