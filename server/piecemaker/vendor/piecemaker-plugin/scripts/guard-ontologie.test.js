const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'guard-ontologie.mjs')).href);
const cwd = '/tmp/Dossier Exemple';
const decision = async (tool_name, tool_input) => (await load()).ontologyDecision({ tool_name, tool_input, cwd })?.hookSpecificOutput.permissionDecision ?? null;

test('refuse l’écriture directe de l’ontologie, de l’arborescence et des étapes', async () => {
  assert.equal(await decision('Write', { file_path: '.piecemaker/ontologie.json', content: '{}' }), 'deny');
  assert.equal(await decision('Edit', { file_path: `${cwd}/.piecemaker/arborescence.json` }), 'deny');
  assert.equal(await decision('MultiEdit', { file_path: '.piecemaker/etapes.json' }), 'deny');
  assert.equal(await decision('Bash', { command: 'echo "{}" > .piecemaker/ontologie.json' }), 'deny');
  assert.equal(await decision('Bash', { command: "sed -i '' 's/a/b/' .piecemaker/etapes.json" }), 'deny');
  assert.equal(await decision('Bash', { command: 'rm -f .piecemaker/etapes.json' }), 'deny');
  assert.equal(await decision('apply_patch', { command: '*** Begin Patch\n*** Update File: .piecemaker/ontologie.json\n' }), 'deny');
});

test('refuse les commandes shell qui ne sont pas de simple lecture', async () => {
  assert.equal(await decision('Bash', { command: 'python3 -c "import json" .piecemaker/ontologie.json' }), 'deny');
  assert.equal(await decision('Bash', { command: 'cat a.md | xargs -I{} cp {} .piecemaker/etapes.json' }), 'deny');
  assert.equal(await decision('Bash', { command: 'jq -i . ~/.piecemaker/ontologie.json' }), 'deny');
  assert.equal(await decision('Bash', { command: 'find .piecemaker/etapes.json -name "*.md" -delete' }), 'deny');
  assert.equal(await decision('Bash', { command: 'grep x .piecemaker/etapes.json 2>.piecemaker/etapes.json' }), 'deny');
  assert.equal(await decision('Bash', { command: 'echo $(cp a.md .piecemaker/etapes.json)' }), 'deny');
  assert.equal(await decision('Bash', { command: 'awk 1 .piecemaker/etapes.json' }), 'deny');
});

test('laisse écrire les fiches OKF', async () => {
  assert.equal(await decision('Write', { file_path: '.piecemaker/okf/Pièces/Contrat.pdf.md', content: 'x' }), null);
  assert.equal(await decision('Bash', { command: 'cp a.md .piecemaker/okf/b.md' }), null);
  assert.equal(await decision('apply_patch', { command: '*** Begin Patch\n*** Add File: .piecemaker/okf/Pièces/Note.md\n+x\n*** End Patch' }), null);
});

test('interdit tout accès à la clé de sceau', async () => {
  assert.equal(await decision('Read', { file_path: '/Users/exemple/.piecemaker/ontologie.cle' }), 'deny');
  assert.equal(await decision('Grep', { pattern: 'x', path: '/Users/exemple/.piecemaker/ontologie.cle' }), 'deny');
  assert.equal(await decision('Bash', { command: 'cat ~/.piecemaker/ontologie.cle' }), 'deny');
});

test('suit le format Codex : apply_patch avec le patch dans tool_input.command', async () => {
  assert.equal(await decision('apply_patch', { command: '*** Begin Patch\n*** Add File: .piecemaker/etapes.json\n+x\n*** End Patch' }), 'deny');
  assert.equal(await decision('apply_patch', { command: '*** Begin Patch\n*** Update File: notes.md\n*** End Patch' }), null);
  assert.equal(await decision('Bash', { command: ['bash', '-lc', 'cp a .piecemaker/etapes.json'] }), 'deny');
});

test('laisse lire ces fichiers et écrire ailleurs', async () => {
  assert.equal(await decision('Bash', { command: 'cat .piecemaker/ontologie.json 2>&1 | head -20' }), null);
  assert.equal(await decision('Bash', { command: "cat a.json; sed -n '1,180p' .piecemaker/okf/index.md" }), null);
  assert.equal(await decision('Bash', { command: "sed -n '1,5w .piecemaker/etapes.json' a.md" }), 'deny');
  assert.equal(await decision('Bash', { command: "sed -i -n '1,5p' .piecemaker/etapes.json" }), 'deny');
  assert.equal(await decision('Bash', { command: 'grep -r "amends" .piecemaker/okf' }), null);
  assert.equal(await decision('Bash', { command: 'pm okf link Pièces/Courrier.pdf amends Pièces/Contrat.pdf --citation "Il est résilié."' }), null);
  assert.equal(await decision('Write', { file_path: '.piecemaker/memoires/bail.md' }), null);
  assert.equal(await decision('Read', { file_path: '.piecemaker/ontologie.json' }), null);
  assert.equal(await decision('Bash', { command: 'ls .piecemaker/okf 2>/dev/null && jq .relations ~/.piecemaker/ontologie.json' }), null);
  assert.equal(await decision('Bash', { command: 'find .piecemaker/okf -name "*.md" | wc -l' }), null);
  assert.equal(await decision('Bash', { command: 'cd "/tmp/Dossier A" && grep -n -i -E "26_|_parties|partie" .piecemaker/okf/index.md | head -20' }), null);
  assert.equal(await decision('Bash', { command: 'cd "/tmp/Dossier A" && ls .piecemaker/okf; ls .piecemaker/okf/* | grep -i -E "partie|ZETABIO SA|PERSON" | head' }), null);
});

test('laisse lire les fiches dans une boucle et une substitution de commande', async () => {
  const racine = 'B="$HOME/Documents/Dossiers"; for d in claude codex mistral; do ';
  for (const command of [
    `${racine}echo "======== $d"; pm check --dossier "$B/ESSAI 4 $d" 2>&1 | cut -c1-330 | head -40; echo "-- prémisses citées: $(grep -ho '_premises/[^ )"]*' "$B/ESSAI 4 $d/.piecemaker/catala/restitution/"*.catala_fr | sort -u | wc -l) ; fiches: $(ls "$B/ESSAI 4 $d/.piecemaker/okf/_premises" 2>/dev/null | wc -l)"; done`,
    `${racine}echo "== $d"; grep -ho '_premises/[^ )"]*' "$B/ESSAI 4 $d/.piecemaker/catala/restitution/"*.catala_fr | sort -u | wc -l; ls "$B/ESSAI 4 $d/.piecemaker/okf/_premises" | wc -l; done`,
    'echo $(cat .piecemaker/arborescence.json)',
    'if test -d .piecemaker/okf; then ls .piecemaker/okf; else echo absent; fi',
    "for f in .piecemaker/okf/*.md; do sed -n '1,5p' \"$f\"; done",
  ]) {
    assert.equal(await decision('Bash', { command }), null, command);
  }
});

test('refuse une écriture dans une boucle ou une substitution de commande', async () => {
  for (const command of [
    'for d in a b; do rm -rf "$d/.piecemaker/etapes.json"; done',
    'for d in a b; do ls "$d/.piecemaker/etapes.json" > "$d/.piecemaker/etapes.json"; done',
    'for d in a b; do ls .piecemaker/etapes.json; done > .piecemaker/etapes.json',
    'echo "fiches: $(ls .piecemaker/etapes.json | tee .piecemaker/etapes.json)"',
    'echo "$(echo "$(mv a.md .piecemaker/etapes.json)")"',
    '$(echo rm) -rf .piecemaker/etapes.json',
    'if true; then cp a.md .piecemaker/etapes.json; fi',
    'ls `cp a.md .piecemaker/etapes.json`',
    'for f in .piecemaker/etapes.json; do sed -i "" s/a/b/ "$f"; done',
  ]) {
    assert.equal(await decision('Bash', { command }), 'deny', command);
  }
});

test('refuse une écriture cachée après une chaîne entre guillemets', async () => {
  for (const command of [
    'grep "a|b" x; echo y > .piecemaker/etapes.json',
    'grep "a;b" x; rm .piecemaker/etapes.json',
    'grep "a|b" x | tee .piecemaker/etapes.json',
    'grep "a&b" x && sed -i "" s/a/b/ .piecemaker/etapes.json',
  ]) {
    assert.equal(await decision('Bash', { command }), 'deny', command);
  }
});

test('ne refuse jamais un appel pm okf qui cite des fiches, quelle que soit sa forme', async () => {
  const fiche = '.piecemaker/okf/Pièces/01_Lettre_Jean_Dupont.pdf.md';
  for (const command of [
    `pm okf link ${fiche} responds-to .piecemaker/okf/Pièces/02_Reponse.pdf.md --citation "Le prix (100 $) reste dû ; merci > tout !"`,
    `node /opt/Skill-PieceMaker/scripts/pm.mjs okf link "${fiche}" amends Pièces/Contrat.pdf --citation "x"`,
    `cd "/tmp/Dossier Exemple" && pm okf unlink "${fiche}" amends Pièces/Contrat.pdf`,
    `F="${fiche}"; pm okf link "$F" amends Pièces/Contrat.pdf --citation "x"`,
    `pm okf verify\npm okf link "${fiche}" states "Date" --citation "Le 3 mars."\npm okf verify 2>&1 | head -40`,
  ]) {
    assert.equal(await decision('Bash', { command }), null, command);
  }
  assert.equal(await decision('Bash', { command: ['bash', '-lc', `pm okf link "${fiche}" amends Pièces/Contrat.pdf --citation "x; y"`] }), null);
});

test('un segment pm okf ne couvre pas le reste de la commande', async () => {
  for (const command of [
    'pm okf verify; cp a.md .piecemaker/etapes.json',
    'pm okf verify\nrm -f .piecemaker/etapes.json',
    'pm okf verify > .piecemaker/etapes.json',
    'pm okf link a.pdf amends b.pdf --citation "$(cp a.md .piecemaker/etapes.json)"',
    'pm okf verify | tee .piecemaker/etapes.json',
  ]) {
    assert.equal(await decision('Bash', { command }), 'deny', command);
  }
});

test('explique la voie autorisée', async () => {
  const { ontologyDecision } = await load();
  assert.match(ontologyDecision({ tool_name: 'Write', tool_input: { file_path: '.piecemaker/ontologie.json' }, cwd }).hookSpecificOutput.permissionDecisionReason, /Index › Ontologie tab/);
  assert.match(ontologyDecision({ tool_name: 'Bash', tool_input: { command: 'cp a.md .piecemaker/etapes.json' }, cwd }).hookSpecificOutput.permissionDecisionReason, /case steps/);
});

const fs = require('node:fs');
const os = require('node:os');

function caseFolder(tree, proposal) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Dossier Exemple '));
  fs.mkdirSync(path.join(root, '.piecemaker'));
  fs.writeFileSync(path.join(root, '.piecemaker', 'arborescence.json'), `${JSON.stringify(tree, null, 2)}\n`);
  if (proposal) fs.writeFileSync(path.join(root, '.piecemaker', 'arborescence.proposition.json'), JSON.stringify(proposal));
  return root;
}

const recorder = (answer = { ok: true, output: 'Visible dans Index › Classement.' }) => {
  const calls = [];
  const run = async (args, where) => { calls.push({ args, where }); return answer; };
  return { calls, run };
};

const tree = [{ name: 'Pièces', explanation: 'Pièces du dossier' }, { name: 'Procédure', explanation: '' }];

test('transforme un Edit de l’arborescence en proposition et avertit l’agent', async () => {
  const root = caseFolder(tree);
  const { calls, run } = recorder();
  const result = await (await load()).hookDecision({ tool_name: 'Edit', tool_input: { file_path: '.piecemaker/arborescence.json', old_string: '"name": "Procédure"', new_string: '"name": "Correspondance"' }, cwd: root }, run);
  assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
  const reason = result.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /saved as a proposal in arborescence\.proposition\.json/);
  assert.match(reason, /added: Correspondance; removed: Procédure/);
  assert.match(reason, /Visible dans Index › Classement/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 4), ['dossier', 'arborescence', '--dossier', root]);
  assert.deepEqual(JSON.parse(calls[0].args[5]), [{ nom: 'Pièces', explication: 'Pièces du dossier' }, { nom: 'Correspondance', explication: '' }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.piecemaker', 'arborescence.json'), 'utf8'))[1].name, 'Procédure');
});

test('ajoute la modification à la proposition en attente', async () => {
  const root = caseFolder(tree, { dossiers: [...tree, { name: 'Expertise', explanation: '' }], motif: 'Rapport attendu', date: '2026-01-01' });
  const { calls, run } = recorder();
  const reason = (await (await load()).hookDecision({ tool_name: 'Edit', tool_input: { file_path: `${root}/.piecemaker/arborescence.json`, old_string: '"name": "Expertise",\n    "explanation": ""', new_string: '"name": "Expertise",\n    "explanation": "Rapports"' }, cwd: root }, run)).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /added: Expertise/);
  assert.deepEqual(JSON.parse(calls[0].args[5]).at(-1), { nom: 'Expertise', explication: 'Rapports' });
});

test('repart du fichier actuel quand la proposition ne contient pas le texte', async () => {
  const root = caseFolder(tree, { dossiers: [{ name: 'Autre', explanation: '' }], motif: '', date: '2026-01-01' });
  const { run } = recorder();
  const reason = (await (await load()).hookDecision({ tool_name: 'Edit', tool_input: { file_path: '.piecemaker/arborescence.json', old_string: '"explanation": "Pièces du dossier"', new_string: '"explanation": "Pièces communiquées"' }, cwd: root }, run)).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /changed: Pièces/);
  assert.match(reason, /starts from the current file/);
});

test('signale une modification impossible sans appeler pm', async () => {
  const root = caseFolder(tree);
  const { calls, run } = recorder();
  const { hookDecision } = await load();
  const missing = (await hookDecision({ tool_name: 'Edit', tool_input: { file_path: '.piecemaker/arborescence.json', old_string: 'Inconnu', new_string: 'x' }, cwd: root }, run)).hookSpecificOutput;
  assert.equal(missing.permissionDecision, 'deny');
  assert.match(missing.permissionDecisionReason, /Proposal not saved.*was not found/);
  const broken = (await hookDecision({ tool_name: 'Write', tool_input: { file_path: '.piecemaker/arborescence.json', content: '[{' }, cwd: root }, run)).hookSpecificOutput;
  assert.match(broken.permissionDecisionReason, /invalid JSON/);
  assert.equal(calls.length, 0);
});

test('relaie le refus de pm', async () => {
  const root = caseFolder(tree);
  const { run } = recorder({ ok: false, output: 'Erreur : 31 dossiers, 30 au plus.' });
  const reason = (await (await load()).hookDecision({ tool_name: 'Write', tool_input: { file_path: '.piecemaker/arborescence.json', content: '[]' }, cwd: root }, run)).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /Proposal not saved.*30 au plus/);
});

test('transforme un patch Codex de l’ontologie en proposition', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-home '));
  fs.mkdirSync(path.join(home, '.piecemaker'));
  const relation = { name: 'amends', label: 'modifie', inverse: 'modifié par', description: '', source: ['Pièces'], target: ['Pièces'] };
  fs.writeFileSync(path.join(home, '.piecemaker', 'ontologie.json'), `${JSON.stringify({ relations: [relation], sceau: 'abc' }, null, 2)}\n`);
  const file = path.join(home, '.piecemaker', 'ontologie.json');
  const patch = `*** Begin Patch\n*** Update File: ${file}\n@@\n-      "label": "modifie",\n+      "label": "amende",\n*** End Patch`;
  const { calls, run } = recorder({ ok: true, output: '{}' });
  const reason = (await (await load()).hookDecision({ tool_name: 'apply_patch', tool_input: { command: patch }, cwd: '/tmp/Dossier Exemple' }, run)).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /ontologie\.proposition\.json/);
  assert.match(reason, /changed: amends/);
  assert.deepEqual(calls[0].args.slice(0, 3), ['okf', 'ontologie', 'proposer']);
  assert.equal(JSON.parse(calls[0].args[6]).relations[0].label, 'amende');
});

test('refuse un patch qui mêle l’arborescence à d’autres fichiers', async () => {
  const root = caseFolder(tree);
  const { calls, run } = recorder();
  const patch = '*** Begin Patch\n*** Update File: notes.md\n@@\n-a\n+b\n*** Update File: .piecemaker/arborescence.json\n@@\n-x\n+y\n*** End Patch';
  const reason = (await (await load()).hookDecision({ tool_name: 'apply_patch', tool_input: { command: patch }, cwd: root }, run)).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /alone in its patch/);
  assert.equal(calls.length, 0);
});

test('garde le refus simple pour le shell et la clé', async () => {
  const { hookDecision } = await load();
  const { calls, run } = recorder();
  assert.match((await hookDecision({ tool_name: 'Bash', tool_input: { command: 'echo "[]" > .piecemaker/arborescence.json' }, cwd }, run)).hookSpecificOutput.permissionDecisionReason, /never with the shell/);
  assert.match((await hookDecision({ tool_name: 'Write', tool_input: { file_path: '~/.piecemaker/ontologie.cle'.replace('~', os.homedir()) }, cwd }, run)).hookSpecificOutput.permissionDecisionReason, /seal key/);
  assert.equal(await hookDecision({ tool_name: 'Write', tool_input: { file_path: 'notes.md', content: 'x' }, cwd }, run), null);
  assert.equal(calls.length, 0);
});

test('propose les types de documents en gardant les relations en attente', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-home '));
  fs.mkdirSync(path.join(home, '.piecemaker'));
  const relation = { name: 'amends', label: 'modifie', inverse: 'modifié par', description: '', source: ['Pièces'], target: ['Pièces'] };
  const file = path.join(home, '.piecemaker', 'ontologie.json');
  fs.writeFileSync(file, `${JSON.stringify({ relations: [relation], documentTypes: [{ name: 'Contrat', icon: 'pen' }], sceau: 'abc' }, null, 2)}\n`);
  fs.writeFileSync(path.join(home, '.piecemaker', 'ontologie.proposition.json'), JSON.stringify({ relations: [{ ...relation, label: 'amende' }], motif: '', date: '' }));
  const { calls, run } = recorder({ ok: true, output: '{}' });
  const reason = (await (await load()).hookDecision({ tool_name: 'Edit', tool_input: { file_path: file, old_string: '"icon": "pen"', new_string: '"icon": "scroll"' }, cwd: '/tmp/Dossier Exemple' }, run)).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /relations — changed: amends; document types — changed: Contrat/);
  const sent = JSON.parse(calls[0].args[6]);
  assert.equal(sent.relations[0].label, 'amende');
  assert.deepEqual(sent.documentTypes, [{ name: 'Contrat', icon: 'scroll' }]);
  assert.equal(sent.sceau, undefined);
});
