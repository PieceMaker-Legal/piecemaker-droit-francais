const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const hook = path.join(__dirname, 'cloisonnement.mjs');
const repositoryRoot = path.resolve(__dirname, '../../../../..');
fs.mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(repositoryRoot, '.tmp', 'cloisonnement-')));
const home = path.join(sandbox, 'piecemaker-home');
const dupont = path.join(sandbox, 'Dossier Dupont');
const exemple = path.join(sandbox, 'Societe Exemple');
const central = path.join(sandbox, 'PieceMaker Agent');
const shared = path.join(central, '.piecemaker', 'orchestrateur', 'fichiers');
for (const folder of [dupont, exemple, shared, home]) fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(central, '.piecemaker', 'agent-central'), '');
fs.writeFileSync(path.join(shared, 'modele.md'), 'modèle');
fs.writeFileSync(path.join(exemple, 'contrat.md'), 'contrat fictif');
fs.writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ version: 1, sources: { test: [dupont, exemple, central] } }));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function decision(tool_name, tool_input, cwd = dupont) {
  const output = execFileSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name, tool_input, cwd, hook_event_name: 'PreToolUse' }),
    env: { ...process.env, PIECEMAKER_HOME: home },
    encoding: 'utf8',
  });
  return output.trim() ? JSON.parse(output).hookSpecificOutput.permissionDecision : 'allow';
}

test('une session de dossier ne lit ni n’écrit dans un autre dossier, quel que soit l’outil', () => {
  assert.equal(decision('Read', { file_path: path.join(exemple, 'contrat.md') }), 'deny');
  assert.equal(decision('Write', { file_path: path.join(exemple, 'nouveau.md'), content: 'x' }), 'deny');
  assert.equal(decision('Grep', { pattern: 'x', path: exemple }), 'deny');
  assert.equal(decision('Glob', { pattern: `${exemple}/**/*.md` }), 'deny');
  assert.equal(decision('Bash', { command: 'cat ../"Societe Exemple"/contrat.md' }), 'deny');
  assert.equal(decision('Bash', { command: ['bash', '-lc', `ls ${JSON.stringify(exemple)}`] }), 'deny');
  assert.equal(decision('Bash', { command: `cp notes.md --target-directory=${JSON.stringify(exemple)}` }), 'deny');
  assert.equal(decision('apply_patch', { command: `*** Begin Patch\n*** Add File: ${path.join(exemple, 'note.md')}\n+x\n*** End Patch` }), 'deny');
});

test('son propre dossier, les chemins hors dossiers et le dossier partagé de l’agent central restent ouverts', () => {
  assert.equal(decision('Read', { file_path: path.join(dupont, 'notes.md') }), 'allow');
  assert.equal(decision('Bash', { command: 'pandoc notes.md -o note.docx && ls ~/' }), 'allow');
  assert.equal(decision('Read', { file_path: path.join(shared, 'modele.md') }), 'allow');
  assert.equal(decision('Read', { file_path: path.join(central, '.piecemaker', 'orchestrateur', 'etat.json') }), 'deny');
  assert.equal(decision('Read', { file_path: path.join(exemple, 'contrat.md') }, path.join(sandbox, 'ailleurs')), 'allow');
});

test('l’agent central ne lit pas lui-même les dossiers : il passe par un fil', () => {
  assert.equal(decision('Read', { file_path: path.join(dupont, 'notes.md') }, central), 'deny');
  assert.equal(decision('Read', { file_path: path.join(shared, 'modele.md') }, central), 'allow');
});

test('un usage CLI ordinaire reste entièrement libre : seuls les autres dossiers sont fermés', () => {
  for (const command of [
    'git status && git log --oneline -5',
    'npm install --prefix /tmp/outil && npx tsx script.ts',
    'cat ~/.config/outil/config.json; ls ~/.cache /tmp /usr/local/bin',
    'pm okf verify && docx read notes.docx',
    'curl -s https://example.org -o /tmp/page.html',
    'cd .. && ls',
    'find / -name "*.log" 2>/dev/null | head',
  ]) {
    assert.equal(decision('Bash', { command }), 'allow', command);
  }
});

test('le brain de l’agent central tient ses limites de lignes, quel que soit l’outil d’écriture', () => {
  const lines = (count) => Array.from({ length: count }, (_, index) => `ligne ${index + 1}`).join('\n') + '\n';
  assert.equal(decision('Write', { file_path: path.join(central, 'AGENTS.md'), content: lines(200) }, central), 'allow');
  assert.equal(decision('Write', { file_path: path.join(central, 'AGENTS.md'), content: lines(201) }, central), 'deny');
  assert.equal(decision('Write', { file_path: path.join(central, 'projects', 'Dossier Dupont', 'Timeline.json'), content: lines(500) }, central), 'allow');
  const about = path.join(central, 'projects', 'Dossier Dupont', 'About.md');
  fs.mkdirSync(path.dirname(about), { recursive: true });
  fs.writeFileSync(about, lines(199));
  assert.equal(decision('Edit', { file_path: about, old_string: 'ligne 199', new_string: 'ligne 199\nligne 200' }, central), 'allow');
  assert.equal(decision('Edit', { file_path: about, old_string: 'ligne 199', new_string: 'ligne 199\nligne 200\nligne 201' }, central), 'deny');
  assert.equal(decision('Write', { file_path: path.join(central, 'notes.md'), content: lines(500) }, central), 'allow');
  assert.equal(decision('Write', { file_path: path.join(dupont, 'About.md'), content: lines(500) }), 'allow');
});

test('une session de dossier n’ouvre dans le brain que sa propre paire About.md et Timeline.json', () => {
  fs.writeFileSync(path.join(home, 'brain.json'), JSON.stringify({ path: central }));
  fs.mkdirSync(path.join(central, '.piecemaker'), { recursive: true });
  fs.writeFileSync(path.join(central, '.piecemaker', 'dossiers.json'), JSON.stringify({ [dupont]: 'Dossier Dupont', [exemple]: 'Societe Exemple' }));
  const own = path.join(central, 'projects', 'Dossier Dupont');
  const other = path.join(central, 'projects', 'Societe Exemple');
  try {
    assert.equal(decision('Read', { file_path: path.join(own, 'Timeline.json') }), 'allow');
    assert.equal(decision('Write', { file_path: path.join(own, 'About.md'), content: 'Statut : en cours\n' }), 'allow');
    assert.equal(decision('Read', { file_path: path.join(other, 'Timeline.json') }), 'deny');
    assert.equal(decision('Read', { file_path: path.join(central, 'AGENTS.md') }), 'deny');
    assert.equal(decision('Write', { file_path: path.join(own, 'About.md'), content: Array.from({ length: 201 }, () => 'x').join('\n') }), 'deny');
  } finally {
    fs.rmSync(path.join(home, 'brain.json'), { force: true });
  }
});
