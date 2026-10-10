const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const hook = path.join(__dirname, 'protect-originals.mjs');
const repositoryRoot = path.resolve(__dirname, '../../../../..');
fs.mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(repositoryRoot, '.tmp', 'protect-originals-git-')));
const home = path.join(sandbox, 'piecemaker-home');
const caseRoot = path.join(sandbox, 'Dossier Exemple');
fs.mkdirSync(path.join(caseRoot, 'pieces'), { recursive: true });
fs.writeFileSync(path.join(caseRoot, 'pieces', 'contrat-fictif.pdf'), '%PDF fictif');
fs.writeFileSync(path.join(caseRoot, 'notes.md'), 'notes');
fs.mkdirSync(home, { recursive: true });
for (const file of ['projects.json', 'anonymized-projects.json']) {
  fs.writeFileSync(path.join(home, file), JSON.stringify({ version: 1, sources: { test: [caseRoot] } }));
}
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function decision(command) {
  const output = execFileSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: caseRoot, hook_event_name: 'PreToolUse' }),
    env: { ...process.env, PIECEMAKER_HOME: home },
    encoding: 'utf8',
  });
  return output.trim() ? JSON.parse(output).hookSpecificOutput?.permissionDecision : 'allow';
}

test('bouclier vert : Git ne fait pas sortir le contenu d’une pièce ou d’un mapping', () => {
  for (const command of [
    'git show HEAD:pieces/contrat-fictif.pdf',
    'git show HEAD~2:mapping_default.json > /tmp/copie.json',
    'git cat-file -p 1a2b3c',
    'git log -p --text -- pieces',
    'git archive HEAD -o /tmp/dossier.zip',
  ]) {
    assert.equal(decision(command), 'deny', command);
  }
});

test('bouclier vert : consulter et restaurer l’historique reste possible', () => {
  for (const command of [
    'git log --oneline -- notes.md',
    'git diff HEAD~1 -- notes.md',
    'git show HEAD:notes.md',
    'git restore --source HEAD~1 -- notes.md',
  ]) {
    assert.equal(decision(command), 'allow', command);
  }
});
