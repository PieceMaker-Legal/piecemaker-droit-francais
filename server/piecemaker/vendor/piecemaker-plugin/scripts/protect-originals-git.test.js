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

function readReason(file) {
  const output = execFileSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(caseRoot, file) }, cwd: caseRoot, hook_event_name: 'PreToolUse' }),
    env: { ...process.env, PIECEMAKER_HOME: home },
    encoding: 'utf8',
  });
  return JSON.parse(output).hookSpecificOutput.permissionDecisionReason;
}

test('une pièce déplacée hors de l’application retrouve son Markdown par Git, sinon le refus donne la commande', () => {
  const { homonymMarkdownStem } = require('./lib/markdown-name.cjs');
  const git = (...args) => execFileSync('git', ['-C', caseRoot, '-c', 'user.name=Jean Dupont', '-c', 'user.email=jean.dupont@example.com', ...args], { stdio: 'ignore' });
  const converted = path.join(caseRoot, 'Fichiers convertis PieceMaker');
  fs.mkdirSync(converted, { recursive: true });
  fs.writeFileSync(path.join(converted, `${homonymMarkdownStem(path.join(caseRoot, 'pieces/contrat-fictif.pdf'), caseRoot)}.md`), '# Contrat\n');
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'pièces');
  fs.mkdirSync(path.join(caseRoot, 'Archives'));
  fs.renameSync(path.join(caseRoot, 'pieces/contrat-fictif.pdf'), path.join(caseRoot, 'Archives/contrat-fictif.pdf'));

  const moved = homonymMarkdownStem(path.join(caseRoot, 'Archives/contrat-fictif.pdf'), caseRoot);
  assert.match(readReason('Archives/contrat-fictif.pdf'), new RegExp(`Lisez le Markdown anonymisé à la place : .*${moved}\\.md`));
  assert.ok(fs.existsSync(path.join(converted, `${moved}.md`)));

  fs.writeFileSync(path.join(caseRoot, 'Archives/nouvelle.pdf'), '%PDF nouvelle');
  const launcher = path.join(caseRoot, '.agents/skills/Skill-PieceMaker/scripts/pm');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.writeFileSync(launcher, '#!/bin/sh\n');
  const command = `"${launcher}" conversion --dossier "${caseRoot}"`;
  assert.ok(readReason('Archives/nouvelle.pdf').endsWith(`Convertissez-la avec : ${command}`));
  assert.equal(decision(command), 'allow');
});
