const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const adapter = path.join(__dirname, 'vibe-hook.mjs');
const load = () => import(pathToFileURL(adapter).href);
const script = (name) => path.resolve(__dirname, name);
const secrets = path.resolve(__dirname, '../../installer/assets/claude-hooks/piecemaker-guard-secrets.mjs');
const repositoryRoot = path.resolve(__dirname, '../../../../..');
fs.mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(repositoryRoot, '.tmp', 'vibe-hook-')));
const piecemakerHome = path.join(sandbox, 'piecemaker-home');
const home = path.join(sandbox, 'home');
const caseRoot = path.join(sandbox, 'Dossier Exemple');
const secretFile = path.join(sandbox, 'secret.env');
fs.mkdirSync(path.join(caseRoot, 'Pièces'), { recursive: true });
fs.mkdirSync(path.join(caseRoot, '.piecemaker'), { recursive: true });
fs.writeFileSync(path.join(caseRoot, 'Pièces', 'contrat fictif.pdf'), '%PDF fictif');
fs.writeFileSync(secretFile, 'CLE=fictive');
fs.mkdirSync(path.join(home, '.vibe', 'agents'), { recursive: true });
fs.writeFileSync(path.join(home, '.vibe', 'agents', 'research-maker.toml'), 'instructions = "Recherche fictive"\n');
fs.mkdirSync(piecemakerHome, { recursive: true });
fs.writeFileSync(path.join(piecemakerHome, 'projects.json'), JSON.stringify({ version: 1, sources: { test: [caseRoot] } }));
fs.writeFileSync(path.join(piecemakerHome, 'anonymized-projects.json'), JSON.stringify({ version: 1, sources: { test: [caseRoot] } }));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const env = { ...process.env, HOME: home, USERPROFILE: home, PIECEMAKER_HOME: piecemakerHome, PIECEMAKER_SECRET_PATHS: secretFile };
const pre = (tool_name, tool_input, extra = {}) => ({ hook_event_name: 'pre_tool', session_id: 's1', transcript_path: '', cwd: caseRoot, parent_session_id: null, tool_name, tool_call_id: 'c1', tool_input, ...extra });

function hook(name, payload) {
  const output = execFileSync(process.execPath, [adapter, script(name)], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  return output.trim() ? JSON.parse(output) : null;
}

test('traduit les noms d’outils Vibe en noms Claude', async () => {
  const { claudeToolName } = await load();
  assert.deepEqual(['read_file', 'write_file', 'edit', 'grep', 'bash', 'git_bash', 'windows_shell', 'task', 'legifrance_Search_Jurisprudence', 'autre'].map(claudeToolName),
    ['Read', 'Write', 'Edit', 'Grep', 'Bash', 'Bash', 'Bash', 'Task', 'mcp__legifrance__Search_Jurisprudence', 'autre']);
  assert.deepEqual(['file_system.read_file', 'file_system.write_file', 'file_system.search_replace', 'file_system.bash', 'process.start', 'subagent.spawn', 'mcp_legifrance.Search_Code'].map(claudeToolName),
    ['Read', 'Write', 'Edit', 'Bash', 'Bash', 'Task', 'mcp__legifrance__Search_Code']);
});

test('protect-originals refuse la lecture d’une pièce protégée', () => {
  const decision = hook('protect-originals.mjs', pre('read_file', { file_path: path.join(caseRoot, 'Pièces', 'contrat fictif.pdf') }));
  assert.equal(decision.decision, 'deny');
  assert.ok(decision.reason);
});

test('guard-ontologie refuse l’écriture dans .piecemaker/etapes.json avec son motif', () => {
  const decision = hook('guard-ontologie.mjs', pre('write_file', { file_path: '.piecemaker/etapes.json', content: 'x' }));
  assert.equal(decision.decision, 'deny');
  assert.ok(decision.reason);
});

test('guard-legal-search réserve Search_* au sous-agent research-maker', () => {
  const search = pre('legifrance_Search_Jurisprudence', { query: 'bail commercial' });
  assert.equal(hook('guard-legal-search.mjs', search).decision, 'deny');
  const parent = path.join(sandbox, 'sessions', 'parent');
  const child = path.join(parent, 'agents', 'enfant');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(parent, 'meta.json'), JSON.stringify({ child_sessions: [{ session_id: 'enfant-1', agent: 'research-maker', relative_path: 'agents/enfant' }] }));
  assert.equal(hook('guard-legal-search.mjs', { ...search, session_id: 'enfant-1', parent_session_id: 'p1', transcript_path: path.join(child, 'messages.jsonl') }), null);
});

test('la garde des secrets refuse par code 2 et le motif passe à Vibe', () => {
  const decision = hook(secrets, pre('read_file', { file_path: secretFile }));
  assert.equal(decision.decision, 'deny');
  assert.ok(decision.reason);
});

test('classify-ai-documents classe un fichier écrit par l’IA après write_file', () => {
  const written = path.join(caseRoot, 'note fictive.pdf');
  fs.writeFileSync(written, '%PDF fictif');
  const payload = { ...pre('write_file', { file_path: written, content: '%PDF fictif' }), hook_event_name: 'post_tool', tool_status: 'success', tool_output: { message: 'ok' } };
  assert.equal(hook('classify-ai-documents.mjs', payload), null);
  assert.match(fs.readFileSync(path.join(caseRoot, '.piecemaker', 'protection.json'), 'utf8'), /note fictive\.pdf/);
});

test('task devient un appel Task et le contexte post-outil revient à Vibe', async () => {
  const { claudePayload, vibeResponse } = await load();
  const payload = claudePayload({ hook_event_name: 'post_tool', tool_name: 'task', tool_input: { task: 'Indexer', agent: 'index-maker' }, tool_status: 'success', tool_output: { response: 'fait' }, cwd: caseRoot });
  assert.equal(payload.hook_event_name, 'PostToolUse');
  assert.equal(payload.tool_name, 'Task');
  assert.deepEqual(payload.tool_input, { subagent_type: 'index-maker', prompt: 'Indexer' });
  assert.deepEqual(payload.tool_response, { response: 'fait' });
  assert.deepEqual(claudePayload({ hook_event_name: 'pre_tool', tool_name: 'subagent.spawn', tool_input: { agentName: 'a1', agentType: 'index-maker', message: 'Indexer' }, cwd: caseRoot }).tool_input, { subagent_type: 'index-maker', prompt: 'Indexer' });
  assert.deepEqual(vibeResponse(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Relancez index-maker.' } }), 0, ''),
    { hook_specific_output: { additional_context: 'Relancez index-maker.' } });
  assert.deepEqual(vibeResponse(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', updatedInput: { command: 'ls' } } }), 0, ''),
    { hook_specific_output: { tool_input: { command: 'ls' } } });
  assert.equal(vibeResponse('', 0, ''), null);
});
