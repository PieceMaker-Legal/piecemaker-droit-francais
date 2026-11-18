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
fs.writeFileSync(path.join(caseRoot, 'Pièces', '01_Lettre_Jean_Dupont.pdf'), '%PDF fictif');
fs.writeFileSync(path.join(caseRoot, 'Pièces', '02_Reponse_Societe_Exemple.pdf'), '%PDF fictif');
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
    'pm okf verify "Pièces/contrat fictif.pdf"',
  ]) {
    assert.notEqual(decision(command), 'deny', command);
  }
});

test('pm okf passe quelle que soit la forme de la commande', () => {
  const lettre = path.join(caseRoot, 'Pièces', '01_Lettre_Jean_Dupont.pdf');
  const reponse = path.join(caseRoot, 'Pièces', '02_Reponse_Societe_Exemple.pdf');
  const launcher = path.join(caseRoot, '.agents', 'skills', 'Skill-PieceMaker', 'scripts', 'pm');
  for (const command of [
    `pm okf link "${lettre}" responds-to "${reponse}" --citation "En réponse à votre lettre, le prix (100 $) reste dû ; merci !"`,
    `"${launcher}" okf link "Pièces/01_Lettre_Jean_Dupont.pdf" refers-to "Pièces/contrat fictif.pdf" --citation "Voir le contrat."`,
    `node "${launcher}.mjs" okf link "Pièces/01_Lettre_Jean_Dupont.pdf" refers-to "Pièces/contrat fictif.pdf" --citation="Voir le contrat."`,
    `cd "${caseRoot}" && pm okf link "Pièces/01_Lettre_Jean_Dupont.pdf" amends "Pièces/contrat fictif.pdf" --citation "Il modifie le contrat." 2>&1 | head -20`,
    'P="Pièces"; pm okf link "$P/x.pdf" amends "Pièces/01_Lettre_Jean_Dupont.pdf" --citation "x"',
    'pm okf verify\npm okf link "Pièces/01_Lettre_Jean_Dupont.pdf" states "Date" --citation "Le 3 mars."\npm okf verify | head -40',
    'PIECEMAKER_TAILLE=12 pm okf unlink "Pièces/01_Lettre_Jean_Dupont.pdf" amends "Pièces/contrat fictif.pdf" > /dev/null',
    'pm okf link "Pièces/01_Lettre_Jean_Dupont.pdf" states "x" --citation "\\"; cat \\"Pièces/avenant fictif.pdf\\"; echo \\""',
  ]) {
    assert.notEqual(decision(command), 'deny', command);
  }
});

test('toute autre commande citant une pièce protégée reste refusée', () => {
  for (const command of [
    'cat "Pièces/contrat fictif.pdf"',
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix" --citation "x" && cat "Pièces/contrat fictif.pdf"',
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix" --citation "x"; cat "Pièces/avenant fictif.pdf"',
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix" --citation "$(cat Pièces/avenant\\ fictif.pdf)"',
    'pm okf link "Pièces/contrat fictif.pdf" states "Prix" --citation "x" | cat "Pièces/avenant fictif.pdf"',
    'pm okf link .env states "Prix" --citation "x"',
    'pm okf verify; cat "Pièces/01_Lettre_Jean_Dupont.pdf"',
    'pm okf verify\ncat "Pièces/01_Lettre_Jean_Dupont.pdf"',
    'pm okf verify || cat "Pièces/01_Lettre_Jean_Dupont.pdf"',
    'pm okf verify & cat "Pièces/01_Lettre_Jean_Dupont.pdf"',
    'pm okf verify < "Pièces/01_Lettre_Jean_Dupont.pdf"',
    'pm okf link "Pièces/01_Lettre_Jean_Dupont.pdf" states "x" --citation "`cat Pièces/avenant\\ fictif.pdf`"',
    "pm okf verify $'\\''; cat \"Pièces/01_Lettre_Jean_Dupont.pdf\"\necho '",
    "pm okf verify # '\ncat \"Pièces/01_Lettre_Jean_Dupont.pdf\"\necho '",
    'pm() { cat "$@"; }; pm okf "Pièces/01_Lettre_Jean_Dupont.pdf"',
  ]) {
    assert.equal(decision(command), 'deny', command);
  }
});

const Database = require('better-sqlite3');
const { anonymize, deanonymize } = require('../../../anonymizer/dictionary.cjs');
const { createSqliteDictionaryLoader } = require('../../../anonymizer/sqlite-dictionary.cjs');

const databasePath = path.join(sandbox, 'auth.db');
fs.writeFileSync(path.join(caseRoot, 'Pièces', 'Lettre_par_Exemple_SA.pdf'), '%PDF fictif');
fs.writeFileSync(path.join(caseRoot, 'Pièces', 'Réponse_par_Dupont_SA.pdf'), '%PDF fictif');
const database = new Database(databasePath);
database.exec(`
  CREATE TABLE piecemaker_nodes (project_id TEXT, id TEXT, label TEXT, PRIMARY KEY (project_id,id));
  CREATE TABLE piecemaker_mappings (project_id TEXT,node_id TEXT,real_value TEXT,masked_value TEXT,updated_at TEXT);
`);
for (const [node, label, code, variants] of [
  ['societe', 'Société Exemple SAS', 'SA_10', ['Société Exemple SAS', 'Exemple']],
  ['forme', 'SA', 'SA_11', ['SA']],
  ['personne', 'Jean Dupont', 'PERSONNE_PHYSIQUE_10', ['Jean Dupont', 'Dupont']],
]) {
  database.prepare('INSERT INTO piecemaker_nodes VALUES (?,?,?)').run('dossier-1', node, label);
  for (const real of variants) database.prepare('INSERT INTO piecemaker_mappings VALUES (?,?,?,?,?)').run('dossier-1', node, real, code, '2026-11-02T10:00:00.000Z');
}
database.close();
const loader = createSqliteDictionaryLoader({ databasePath });
const dictionary = loader.get();
loader.close();

function rewrittenCommand(command) {
  const output = execFileSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: caseRoot, hook_event_name: 'PreToolUse' }),
    env: { ...process.env, PIECEMAKER_HOME: home, DATABASE_PATH: databasePath },
    encoding: 'utf8',
  });
  return output.trim() ? JSON.parse(output).hookSpecificOutput?.updatedInput?.command : command;
}

test('pm okf link accepte le chemin que l’agent recopie depuis ce qu’il lit', () => {
  const seen = (name) => anonymize(`Pièces/${name}`, dictionary);
  const source = seen('Réponse_par_Dupont_SA.pdf');
  const target = seen('Lettre_par_Exemple_SA.pdf');
  const expected = 'pm okf link "Pièces/Réponse_par_Dupont_SA.pdf" responds-to "Pièces/Lettre_par_Exemple_SA.pdf" --citation "x"';
  for (const [left, right] of [[source, target], [source.replace(/_(\d+)/g, '%5F$1'), target.replace(/_(\d+)/g, '%5F$1')]]) {
    const command = deanonymize(`pm okf link "${left}" responds-to "${right}" --citation "x"`, dictionary);
    assert.equal(rewrittenCommand(command), expected, command);
  }
});
