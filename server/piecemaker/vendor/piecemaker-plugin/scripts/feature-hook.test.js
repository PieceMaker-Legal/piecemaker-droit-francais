const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'feature-hook.mjs')).href);
const loadFeatures = () => import(pathToFileURL(path.join(__dirname, 'lib', 'features.mjs')).href);
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
  assert.deepEqual([of('raisonnements/indemnite.yaml').feature.nom, of('raisonnements/indemnite.yaml').nom], ['raisonnement', 'indemnite']);
  assert.deepEqual([of('appel-suivi.json').feature.nom, of('appel-suivi.json').nom], ['suivi', 'appel-suivi.json']);
  assert.deepEqual([of('catala/indemnite/indemnite.catala_fr').feature.nom, of('catala/indemnite/indemnite.catala_fr').nom], ['catala', 'indemnite']);
  assert.equal(of('catala/indemnite/_build/x.catala_fr'), null);
  assert.equal(of('protection.json'), null);
  assert.equal(featureOf(path.join(root, 'pieces', 'a.md')), null);
  assert.equal(featureOf(path.join(root, '.piecemaker', 'okf')).feature.nom, 'okf');
});

test('une écriture de raisonnement lance son vérificateur et rend le résultat à l’agent', async () => {
  const { featureReport } = await load();
  const pm = fakePm('indemnite.yaml\n  6:7  warning  fait non établi');
  const report = await featureReport({ tool_name: 'Write', cwd: root, tool_input: { file_path: '.piecemaker/raisonnements/indemnite.yaml' } }, { run: pm.run });
  assert.deepEqual(pm.calls, [{ args: `raisonnement verifier --raisonnement indemnite --dossier ${root}`, cwd: root, timeoutMs: 60000 }]);
  assert.match(report.hookSpecificOutput.additionalContext, /Vérification automatique \(raisonnement\)[\s\S]*fait non établi/);
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
  for (const file_path of ['pieces/note.md', '.piecemaker/okf/pieces/a.md', '.piecemaker/arborescence.json']) {
    assert.equal(await featureReport({ tool_name: 'Edit', cwd: root, tool_input: { file_path } }, { run: pm.run }), null);
  }
  assert.equal(await featureReport({ tool_name: 'Bash', cwd: root, tool_input: { command: 'cat .piecemaker/appel-suivi.json' } }, { run: pm.run }), null);
  assert.deepEqual(pm.calls, []);
});

test('Vibe : le chemin passé dans path est reconnu', async () => {
  const { touchedFiles } = await load();
  assert.deepEqual(touchedFiles({ tool_name: 'Write', cwd: root, tool_input: { path: '.piecemaker/suivi.json' } }), [path.join(root, '.piecemaker', 'suivi.json')]);
});
