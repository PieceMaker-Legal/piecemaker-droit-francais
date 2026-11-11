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
  assert.equal(await subagentReport(call('research-maker', caseFolder('b')), pm), null);
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
    'Graphe : 2 élément(s) manquant(s).',
    '- Pièces/avenant-fictif.md : pièce sans prémisse ni lien vers une autre pièce',
    '- /_premises/date-de-rupture.md : prémisse à valeur unique sans valeur',
  ].join('\n');
  const report = await subagentReport(call('premise-maker', caseFolder('d')), fakePm({ 'okf verify-graph': output }));
  const context = report.hookSpecificOutput.additionalContext;
  assert.doesNotMatch(context, /avenant-fictif/);
  assert.match(context, /Manques : 1\./);
  assert.match(context, /Relancez le sous-agent premise-maker/);
});

test('clean verification says there is nothing to fix', async () => {
  const { subagentReport } = await load();
  const pm = fakePm({ 'okf verify': 'Index OKF : aucune erreur.\n' });
  const context = (await subagentReport(call('index-maker', caseFolder('e')), pm)).hookSpecificOutput.additionalContext;
  assert.match(context, /Aucune erreur à corriger\./);
});

test('reasoning-maker checks stale Catala results and #[doc] gaps, not the YAML reasoning', async () => {
  const { subagentReport } = await load();
  const root = caseFolder('f');
  const now = Date.now();
  const program = path.join(root, '.piecemaker', 'catala', 'conclusions-fictives');
  fs.mkdirSync(path.join(program, 'resultats'), { recursive: true });
  fs.writeFileSync(path.join(program, 'regle.catala_fr'), '');
  fs.writeFileSync(path.join(program, 'resultats', 'verification.json'), JSON.stringify({ passed: true, finished_utc: new Date(now - 3600000).toISOString() }));
  const pm = fakePm({
    'okf verify-graph': 'Index OKF : aucune erreur.\nGraphe : 1 élément(s) manquant(s).\n- conclusions-fictives/regle.catala_fr:12 : #[doc] cite une prémisse absente de l\'index : date-de-rupture\n',
  });
  const context = (await subagentReport(call('reasoning-maker', root), { ...pm, now })).hookSpecificOutput.additionalContext;
  assert.ok(!pm.calls.includes('raisonnement lister'));
  assert.match(context, /Catala conclusions-fictives : modifié après la dernière vérification\./);
  assert.match(context, /Relancez le sous-agent reasoning-maker, puis le sous-agent premise-maker/);
});

test('a failing pm call says verification was impossible without asking for a relaunch', async () => {
  const { subagentReport } = await load();
  const run = async () => ({ code: 1, stdout: '', stderr: 'serveur PieceMaker injoignable' });
  const context = (await subagentReport(call('index-maker', caseFolder('g')), { run })).hookSpecificOutput.additionalContext;
  assert.match(context, /vérification impossible \(serveur PieceMaker injoignable\)/);
  assert.match(context, /Vérification incomplète\./);
  assert.doesNotMatch(context, /Relancez|Aucune erreur/);
});
