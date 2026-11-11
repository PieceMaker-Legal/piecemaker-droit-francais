const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const hook = path.join(__dirname, 'protect-originals.mjs');
const repositoryRoot = path.resolve(__dirname, '../../../../..');
fs.mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(repositoryRoot, '.tmp', 'protect-originals-okf-')));
const home = path.join(sandbox, 'piecemaker-home');
const caseRoot = path.join(sandbox, 'Dossier Protege');
fs.mkdirSync(path.join(caseRoot, 'Pièces'), { recursive: true });
fs.writeFileSync(path.join(caseRoot, 'Pièces', 'contrat fictif.pdf'), '%PDF fictif');
fs.writeFileSync(path.join(caseRoot, 'Pièces', 'avenant fictif.pdf'), '%PDF fictif');
fs.writeFileSync(path.join(caseRoot, '.env'), 'CLE=fictive');
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ version: 1, sources: { test: [caseRoot] } }));
fs.writeFileSync(path.join(home, 'anonymized-projects.json'), JSON.stringify({ version: 1, sources: { test: [caseRoot] } }));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function decision(command) {
  const output = execFileSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: caseRoot, hook_event_name: 'PreToolUse' }),
    env: { ...process.env, PIECEMAKER_HOME: home },
    encoding: 'utf8',
  });
  return output.trim() ? JSON.parse(output).hookSpecificOutput?.permissionDecision : 'ask';
}

test('pm okf link et unlink peuvent citer une pièce protégée', () => {
  for (const command of [
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix de vente" --citation "Le prix est fixé à 1 000 euros." --value "1 000 euros" --single',
    `pm okf link '${path.join(caseRoot, 'Pièces', 'avenant fictif.pdf')}' amends "Pièces/contrat fictif.pdf" --citation "Le présent avenant modifie le contrat."`,
    'pm okf unlink "Pièces/avenant fictif.pdf" amends "Pièces/contrat fictif.pdf"',
  ]) {
    assert.notEqual(decision(command), 'deny', command);
  }
});

test('toute autre commande citant une pièce protégée reste refusée', () => {
  for (const command of [
    'cat "Pièces/contrat fictif.pdf"',
    'pm okf verify "Pièces/contrat fictif.pdf"',
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix" --citation "x" && cat "Pièces/contrat fictif.pdf"',
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix" --citation "x"; cat "Pièces/avenant fictif.pdf"',
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix" --citation "$(cat Pièces/avenant\\ fictif.pdf)"',
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix" --citation "x" | cat "Pièces/avenant fictif.pdf"',
    'pm okf link .env states "Prix" --citation "x"',
  ]) {
    assert.equal(decision(command), 'deny', command);
  }
});
