const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'guard-ontologie.mjs')).href);
const cwd = '/tmp/Dossier Exemple';
const decision = async (tool_name, tool_input) => (await load()).ontologyDecision({ tool_name, tool_input, cwd })?.hookSpecificOutput.permissionDecision ?? null;

test('refuse l’écriture directe de l’ontologie, de l’arborescence et des fiches OKF', async () => {
  assert.equal(await decision('Write', { file_path: '.piecemaker/ontologie.json', content: '{}' }), 'deny');
  assert.equal(await decision('Edit', { file_path: `${cwd}/.piecemaker/arborescence.json` }), 'deny');
  assert.equal(await decision('MultiEdit', { file_path: '.piecemaker/okf/Pièces/Contrat.pdf.md' }), 'deny');
  assert.equal(await decision('Bash', { command: 'echo "{}" > .piecemaker/ontologie.json' }), 'deny');
  assert.equal(await decision('Bash', { command: "sed -i '' 's/a/b/' .piecemaker/okf/Pièces/Contrat.pdf.md" }), 'deny');
  assert.equal(await decision('Bash', { command: 'rm -rf .piecemaker/okf' }), 'deny');
  assert.equal(await decision('apply_patch', { command: '*** Begin Patch\n*** Update File: .piecemaker/ontologie.json\n' }), 'deny');
});

test('laisse lire ces fichiers et écrire ailleurs', async () => {
  assert.equal(await decision('Bash', { command: 'cat .piecemaker/ontologie.json 2>&1 | head -20' }), null);
  assert.equal(await decision('Bash', { command: 'grep -r "amends" .piecemaker/okf' }), null);
  assert.equal(await decision('Bash', { command: 'pm okf link Pièces/Courrier.pdf amends Pièces/Contrat.pdf --citation "Il est résilié."' }), null);
  assert.equal(await decision('Write', { file_path: '.piecemaker/raisonnements/bail.yaml' }), null);
  assert.equal(await decision('Read', { file_path: '.piecemaker/ontologie.json' }), null);
});

test('explique la voie autorisée', async () => {
  const { ontologyDecision } = await load();
  assert.match(ontologyDecision({ tool_name: 'Write', tool_input: { file_path: '.piecemaker/ontologie.json' }, cwd }).hookSpecificOutput.permissionDecisionReason, /onglet Index › Ontologie/);
  assert.match(ontologyDecision({ tool_name: 'Bash', tool_input: { command: 'cp a.md .piecemaker/okf/b.md' }, cwd }).hookSpecificOutput.permissionDecisionReason, /pm okf link/);
});
