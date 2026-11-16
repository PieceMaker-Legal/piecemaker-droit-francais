const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'verify-subagent.mjs')).href);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-subagent-'));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function caseFolder(name) {
  const root = path.join(sandbox, name);
  fs.mkdirSync(path.join(root, '.piecemaker'), { recursive: true });
  return root;
}

function fakePm(outputs) {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args.join(' '));
      return { code: 0, stdout: outputs[args.join(' ')] ?? '', stderr: '' };
    },
  };
}

const call = (agent, cwd) => ({ tool_name: 'Agent', tool_input: { subagent_type: agent, prompt: 'tâche' }, cwd });

test('ignores other tools, unknown agents and folders without .piecemaker', async () => {
  const { subagentReport } = await load();
  const pm = fakePm({});
  assert.equal(await subagentReport({ tool_name: 'Bash', tool_input: {}, cwd: caseFolder('a') }, pm), null);
  assert.equal(await subagentReport(call('reasoning-maker', caseFolder('b')), pm), null);
  assert.equal(await subagentReport(call('index-maker', path.join(sandbox, 'absent')), pm), null);
  assert.deepEqual(pm.calls, []);
});

test('index-maker errors ask the main agent to relaunch index-maker', async () => {
  const { subagentReport } = await load();
  const pm = fakePm({ 'okf verify': 'Index OKF : 1 erreur(s).\n- Pièces/contrat-fictif.md : lien sans citation\n' });
  const report = await subagentReport(call('index-maker', caseFolder('c')), pm);
  const context = report.hookSpecificOutput.additionalContext;
  assert.equal(report.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(context, /- Pièces\/contrat-fictif\.md : lien sans citation/);
  assert.match(context, /Relancez le sous-agent index-maker/);
});

test('premise-maker keeps premise gaps only and reports a clean index', async () => {
  const { subagentReport } = await load();
  const output = [
    'Index OKF : aucune erreur.',
    'Graphe : 3 élément(s) manquant(s).',
    '- Pièces/avenant-fictif.md : pièce sans prémisse ni lien vers une autre pièce',
    '- /_premises/date-de-rupture.md : prémisse à valeur unique sans valeur (programme rupture)',
    '- /_premises/date-de-livraison.md : prémisse citée par aucun programme Catala',
    'Examinées sans lien (information, pas un manque) : 1.',
    '- Pièces/courrier-fictif.md : courrier isolé (programme rupture sans rapport)',
  ].join('\n');
  const report = await subagentReport(call('premise-maker', caseFolder('d')), fakePm({ 'okf verify': output }));
  const context = report.hookSpecificOutput.additionalContext;
  assert.doesNotMatch(context, /avenant-fictif|date-de-livraison|courrier-fictif/);
  assert.match(context, /Manques : 1\./);
  assert.match(context, /Relancez le sous-agent premise-maker/);
});

test('clean verification says there is nothing to fix', async () => {
  const { subagentReport } = await load();
  const pm = fakePm({ 'okf verify': 'Index OKF : aucune erreur.\n' });
  const context = (await subagentReport(call('index-maker', caseFolder('e')), pm)).hookSpecificOutput.additionalContext;
  assert.match(context, /Aucune erreur à corriger\./);
});

test('research-maker flags decisions it cites without reading them', async () => {
  const { subagentReport } = await load();
  const home = fs.mkdtempSync(path.join(sandbox, 'home-'));
  fs.mkdirSync(path.join(home, 'decisions'));
  fs.writeFileSync(path.join(home, 'decisions', 'JURITEXT000000000001.json'), '{}');
  process.env.PIECEMAKER_HOME = home;
  try {
    const payload = { ...call('research-maker', caseFolder('h')), tool_response: { content: [{ type: 'text', text: 'Sources : JURITEXT000000000001 ; JURITEXT000000000002 ; 0123456789abcdef01234567' }] } };
    const context = (await subagentReport(payload, fakePm({}))).hookSpecificOutput.additionalContext;
    assert.match(context, /Décisions citées : 3 ; jamais lues par consulter_decision : 2\./);
    assert.doesNotMatch(context, /- JURITEXT000000000001/);
    assert.match(context, /- 0123456789abcdef01234567/);
    assert.match(context, /Relancez le sous-agent research-maker/);
  } finally {
    delete process.env.PIECEMAKER_HOME;
  }
});

test('deep-research-maker flags a research review that failed or is incomplete', async () => {
  const { subagentReport } = await load();
  const listing = { projets: [
    { projet: 'p1', nom: 'Rupture fictive', mode: 'recherche', erreur: 'Recherche trop large : 900 résultats.', a_completer: [] },
    { projet: 'p2', nom: 'Bail fictif', mode: 'recherche', a_completer: [] },
    { projet: 'p3', nom: 'Analyse fictive', mode: 'analyse', a_completer: ['documents'] },
  ], analyses: [] };
  const pm = fakePm({ 'tabular_review lister': `${JSON.stringify(listing)}\nVolet ouvert.` });
  const context = (await subagentReport(call('deep-research-maker', caseFolder('i')), pm)).hookSpecificOutput.additionalContext;
  assert.match(context, /- p1 Rupture fictive : Recherche trop large/);
  assert.match(context, /- p2 Bail fictif : téléchargement en cours/);
  assert.doesNotMatch(context, /p3/);
  assert.match(context, /Relancez le sous-agent deep-research-maker/);
});

test('a failing pm call says verification was impossible without asking for a relaunch', async () => {
  const { subagentReport } = await load();
  const run = async () => ({ code: 1, stdout: '', stderr: 'serveur PieceMaker injoignable' });
  const context = (await subagentReport(call('index-maker', caseFolder('g')), { run })).hookSpecificOutput.additionalContext;
  assert.match(context, /vérification impossible \(serveur PieceMaker injoignable\)/);
  assert.match(context, /Vérification incomplète\./);
  assert.doesNotMatch(context, /Relancez|Aucune erreur/);
});

const stop = (agent, cwd, extra = {}) => ({ hook_event_name: 'SubagentStop', agent_type: agent, cwd, stop_hook_active: false, last_assistant_message: '', ...extra });

test('Codex SubagentStop blocks premise-maker once while a scenario value differs from the premise', async () => {
  const { subagentReport } = await load();
  const output = [
    'Index OKF : aucune erreur.',
    'Graphe : 1 élément(s) manquant(s).',
    '- .piecemaker/catala/rupture/rupture.catala_fr:4 : #[doc] valeur du scénario (1 500 €) différente de la prémisse (1 200 euros) : /_premises/montant.md (programme rupture)',
  ].join('\n');
  const folder = caseFolder('j');
  const blocked = await subagentReport(stop('premise-maker', folder), fakePm({ 'okf verify': output }));
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /valeur du scénario \(1 500 €\)/);
  const released = await subagentReport(stop('premise-maker', folder, { stop_hook_active: true }), fakePm({ 'okf verify': output }));
  assert.equal(released.decision, undefined);
  assert.match(released.systemMessage, /montant\.md/);
});

test('Codex SubagentStop stays silent when nothing is left to fix', async () => {
  const { subagentReport } = await load();
  const pm = fakePm({ 'okf verify': 'Index OKF : aucune erreur.\n' });
  assert.equal(await subagentReport(stop('index-maker', caseFolder('k')), pm), null);
  assert.equal(await subagentReport(stop('explorer', caseFolder('l')), pm), null);
});
