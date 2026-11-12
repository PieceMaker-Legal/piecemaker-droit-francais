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

test('refuse les commandes shell qui ne sont pas de simple lecture', async () => {
  assert.equal(await decision('Bash', { command: 'python3 -c "import json" .piecemaker/ontologie.json' }), 'deny');
  assert.equal(await decision('Bash', { command: 'cat a.md | xargs -I{} cp {} .piecemaker/okf/b.md' }), 'deny');
  assert.equal(await decision('Bash', { command: 'jq -i . ~/.piecemaker/ontologie.json' }), 'deny');
  assert.equal(await decision('Bash', { command: 'find .piecemaker/okf -name "*.md" -delete' }), 'deny');
  assert.equal(await decision('Bash', { command: 'grep x .piecemaker/okf/a.md 2>.piecemaker/okf/b.md' }), 'deny');
  assert.equal(await decision('Bash', { command: 'echo $(cat .piecemaker/arborescence.json)' }), 'deny');
  assert.equal(await decision('Bash', { command: 'awk 1 .piecemaker/okf/a.md' }), 'deny');
});

test('interdit tout accès à la clé de sceau', async () => {
  assert.equal(await decision('Read', { file_path: '/Users/exemple/.piecemaker/ontologie.cle' }), 'deny');
  assert.equal(await decision('Grep', { pattern: 'x', path: '/Users/exemple/.piecemaker/ontologie.cle' }), 'deny');
  assert.equal(await decision('Bash', { command: 'cat ~/.piecemaker/ontologie.cle' }), 'deny');
});

test('suit le format Codex : apply_patch avec le patch dans tool_input.command', async () => {
  assert.equal(await decision('apply_patch', { command: '*** Begin Patch\n*** Add File: .piecemaker/okf/Pièces/Note.md\n+x\n*** End Patch' }), 'deny');
  assert.equal(await decision('apply_patch', { command: '*** Begin Patch\n*** Update File: notes.md\n*** End Patch' }), null);
  assert.equal(await decision('Bash', { command: ['bash', '-lc', 'cp a .piecemaker/okf/b.md'] }), 'deny');
});

test('laisse lire ces fichiers et écrire ailleurs', async () => {
  assert.equal(await decision('Bash', { command: 'cat .piecemaker/ontologie.json 2>&1 | head -20' }), null);
  assert.equal(await decision('Bash', { command: 'grep -r "amends" .piecemaker/okf' }), null);
  assert.equal(await decision('Bash', { command: 'pm okf link Pièces/Courrier.pdf amends Pièces/Contrat.pdf --citation "Il est résilié."' }), null);
  assert.equal(await decision('Write', { file_path: '.piecemaker/raisonnements/bail.yaml' }), null);
  assert.equal(await decision('Read', { file_path: '.piecemaker/ontologie.json' }), null);
  assert.equal(await decision('Bash', { command: 'ls .piecemaker/okf 2>/dev/null && jq .relations ~/.piecemaker/ontologie.json' }), null);
  assert.equal(await decision('Bash', { command: 'find .piecemaker/okf -name "*.md" | wc -l' }), null);
});

test('explique la voie autorisée', async () => {
  const { ontologyDecision } = await load();
  assert.match(ontologyDecision({ tool_name: 'Write', tool_input: { file_path: '.piecemaker/ontologie.json' }, cwd }).hookSpecificOutput.permissionDecisionReason, /onglet Index › Ontologie/);
  assert.match(ontologyDecision({ tool_name: 'Bash', tool_input: { command: 'cp a.md .piecemaker/okf/b.md' }, cwd }).hookSpecificOutput.permissionDecisionReason, /pm okf link/);
});
