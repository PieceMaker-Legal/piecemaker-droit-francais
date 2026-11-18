const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'guard-legal-search.mjs')).href);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-legal-search-'));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function home(name, withAgent) {
  const root = path.join(sandbox, name);
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  if (withAgent) fs.writeFileSync(path.join(root, '.claude', 'agents', 'research-maker.md'), '---\nname: research-maker\n---\n');
  return root;
}

const search = (extra = {}) => ({ tool_name: 'mcp__legifrance__Search_Jurisprudence', tool_input: { query: 'bail commercial' }, cwd: sandbox, ...extra });

test('denies a Légifrance search from the main agent when research-maker is installed', async () => {
  const { searchDecision } = await load();
  const decision = searchDecision(search(), { home: home('a', true) });
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(decision.hookSpecificOutput.permissionDecisionReason, /research-maker/);
  assert.match(decision.hookSpecificOutput.permissionDecisionReason, /consulter_article ou consulter_decision/);
});

test('lets the research-maker sub-agent search', async () => {
  const { searchDecision } = await load();
  assert.equal(searchDecision(search({ agent_id: 'x1', agent_type: 'research-maker' }), { home: home('b', true) }), null);
});

test('denies a Légifrance search from any other sub-agent', async () => {
  const { searchDecision } = await load();
  const installed = home('e', true);
  for (const agent_type of ['explorer', 'general-purpose']) {
    assert.equal(searchDecision(search({ agent_id: 'x2', agent_type }), { home: installed }).hookSpecificOutput.permissionDecision, 'deny');
  }
  assert.equal(searchDecision(search({ agent_id: 'x3' }), { home: installed }).hookSpecificOutput.permissionDecision, 'deny');
});

test('lets a namespaced research-maker search', async () => {
  const { searchDecision } = await load();
  assert.equal(searchDecision(search({ agent_id: 'x4', agent_type: 'piecemaker:research-maker' }), { home: home('f', true) }), null);
});

test('lets reads and other tools through', async () => {
  const { searchDecision } = await load();
  const installed = home('c', true);
  assert.equal(searchDecision(search({ tool_name: 'mcp__legifrance__consulter_article' }), { home: installed }), null);
  assert.equal(searchDecision(search({ tool_name: 'Bash' }), { home: installed }), null);
});

test('lets the main agent search when research-maker is not installed', async () => {
  const { searchDecision } = await load();
  assert.equal(searchDecision(search(), { home: home('d', false) }), null);
});

test('denies a Légifrance search when only the Codex research-maker is installed', async () => {
  const { searchDecision } = await load();
  const root = path.join(sandbox, 'codex');
  fs.mkdirSync(path.join(root, '.codex', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'agents', 'research-maker.toml'), 'name = "research-maker"\n');
  assert.equal(searchDecision(search(), { home: root }).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(searchDecision(search({ agent_id: 'x5', agent_type: 'research-maker' }), { home: root }), null);
});
