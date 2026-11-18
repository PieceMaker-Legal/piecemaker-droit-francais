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
  assert.equal(await subagentReport(call('research-maker', path.join(sandbox, 'absent')), pm), null);
  assert.deepEqual(pm.calls, []);
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

const stop = (agent, cwd, extra = {}) => ({ hook_event_name: 'SubagentStop', agent_type: agent, cwd, stop_hook_active: false, last_assistant_message: '', ...extra });

test('research-maker without cited decision has nothing to fix', async () => {
  const { subagentReport } = await load();
  const context = (await subagentReport(call('research-maker', caseFolder('e')), fakePm({}))).hookSpecificOutput.additionalContext;
  assert.match(context, /Aucune décision citée\./);
  assert.match(context, /Aucune erreur à corriger\./);
});

test('Codex SubagentStop blocks research-maker once while a cited decision was never read', async () => {
  const { subagentReport } = await load();
  const folder = caseFolder('j');
  const message = { last_assistant_message: 'Source : JURITEXT000000000009' };
  const blocked = await subagentReport(stop('research-maker', folder, message), fakePm({}));
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /- JURITEXT000000000009/);
  const released = await subagentReport(stop('research-maker', folder, { ...message, stop_hook_active: true }), fakePm({}));
  assert.equal(released.decision, undefined);
  assert.match(released.systemMessage, /JURITEXT000000000009/);
});

test('Codex SubagentStop stays silent when nothing is left to fix', async () => {
  const { subagentReport } = await load();
  const pm = fakePm({});
  assert.equal(await subagentReport(stop('research-maker', caseFolder('k')), pm), null);
  assert.equal(await subagentReport(stop('explorer', caseFolder('l')), pm), null);
});
