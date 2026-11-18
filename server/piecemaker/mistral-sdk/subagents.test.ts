import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { delegateSubagents } from './subagents.js';

const definition = (name: string) => ({ type: 'function' as const, function: { name, parameters: { type: 'object' } } });
const allow = async (_tool: unknown, input: Record<string, unknown>) => input;

function toolbox(calls: string[]) {
  const tool = (name: string, readOnly = true) => [name, { name, readOnly, definition: definition(name), execute: async (input: Record<string, unknown>) => { calls.push(`${name}:${JSON.stringify(input)}`); return `résultat ${name}`; } }] as const;
  return { instructions: 'Skills disponibles', close: async () => {}, turnEnd: async () => '', tools: new Map([
    tool('mcp__legifrance__Search_Jurisprudence'), tool('mcp__legifrance__consulter_article'), tool('Read'), tool('Write', false), tool('Bash', false),
  ]) };
}

function workspace(agents: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-subagents-'));
  fs.mkdirSync(path.join(root, '.vibe', 'agents'), { recursive: true });
  for (const [slug, instructions] of Object.entries(agents)) {
    fs.writeFileSync(path.join(root, '.vibe', 'agents', `${slug}.toml`), `display_name = "${slug}"\ndescription = "Agent fictif ${slug}."\nagent_type = "subagent"\nactive_model = "mistral-small"\ninstructions = "${instructions}"\n`);
  }
  return root;
}

function scripted(replies: Array<Record<string, unknown>>, requests: Array<{ model: string; tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown }> }>) {
  return { chat: { complete: async (request: never) => { requests.push(structuredClone(request)); return { choices: [{ message: replies.shift() }] }; } } };
}

test('leaves the toolbox untouched when no subagent is installed', () => {
  const root = workspace({});
  try {
    const box = delegateSubagents(toolbox([]), { cwd: root, userHome: root, client: scripted([], []), fallbackModel: 'mistral-medium-latest', signal: new AbortController().signal, authorize: allow });
    assert.ok(box.tools.has('mcp__legifrance__Search_Jurisprudence'));
    assert.equal(box.instructions, 'Skills disponibles');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reserves Légifrance searches to a delegated research-maker loop', async () => {
  const root = workspace({ 'research-maker': 'Méthode de recherche fictive.' });
  const calls: string[] = [];
  const requests: Parameters<typeof scripted>[1] = [];
  const client = scripted([
    { toolCalls: [{ id: 'c1', function: { name: 'mcp__legifrance__Search_Jurisprudence', arguments: '{"query":"bail commercial"}' } }] },
    { toolCalls: [{ id: 'c2', function: { name: 'Write', arguments: '{}' } }] },
    { content: 'Compte rendu fictif.' },
  ], requests);
  try {
    const box = delegateSubagents(toolbox(calls), { cwd: root, userHome: root, client, fallbackModel: 'mistral-medium-latest', signal: new AbortController().signal, authorize: allow });
    assert.equal(box.tools.has('mcp__legifrance__Search_Jurisprudence'), false);
    assert.ok(box.tools.has('mcp__legifrance__consulter_article'));
    const delegate = box.tools.get('research_maker')!;
    assert.equal(delegate.readOnly, true);
    assert.match(box.instructions, /research_maker/);
    assert.equal(await delegate.execute({ task: 'Durée du bail commercial ?' }), 'Compte rendu fictif.');
    assert.deepEqual(calls, ['mcp__legifrance__Search_Jurisprudence:{"query":"bail commercial"}']);
    assert.equal(requests[0].model, 'mistral-small-latest');
    assert.deepEqual(requests[0].tools?.map(tool => tool.function.name).sort(), ['Read', 'mcp__legifrance__Search_Jurisprudence', 'mcp__legifrance__consulter_article']);
    assert.match(String(requests[0].messages[0].content), /Méthode de recherche fictive/);
    assert.match(String(requests[2].messages.at(-1)?.content), /indisponible/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('delegates other subagents with write tools behind the same authorization, without Légifrance searches', async () => {
  const root = workspace({ 'research-maker': 'Recherche fictive.', 'index-maker': 'Index fictif.' });
  const calls: string[] = [];
  const authorized: string[] = [];
  const requests: Parameters<typeof scripted>[1] = [];
  const client = scripted([
    { toolCalls: [{ id: 'c1', function: { name: 'Bash', arguments: '{"command":"pm okf verify"}' } }] },
    { toolCalls: [{ id: 'c2', function: { name: 'Write', arguments: '{"file_path":"a.md"}' } }] },
    { content: 'Index vérifié.' },
  ], requests);
  const authorize = async (tool: { name: string; readOnly: boolean }, input: Record<string, unknown>) => {
    authorized.push(tool.name);
    if (tool.name === 'Write') throw new Error('Autorisation refusée.');
    return input;
  };
  try {
    const box = delegateSubagents(toolbox(calls), { cwd: root, userHome: root, client, fallbackModel: 'mistral-medium-latest', signal: new AbortController().signal, authorize });
    assert.equal(await box.tools.get('index_maker')!.execute({ task: 'Vérifie l’index.' }), 'Index vérifié.');
    assert.deepEqual(requests[0].tools?.map(tool => tool.function.name).sort(), ['Bash', 'Read', 'Write', 'mcp__legifrance__consulter_article']);
    assert.deepEqual(authorized, ['Bash', 'Write']);
    assert.deepEqual(calls, ['Bash:{"command":"pm okf verify"}']);
    assert.match(String(requests[2].messages.at(-1)?.content), /Autorisation refusée/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('appends the PieceMaker check to the research-maker report in a case folder', async () => {
  const root = workspace({ 'research-maker': 'Méthode de recherche fictive.' });
  const previous = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = path.join(root, 'piecemaker-home');
  fs.mkdirSync(path.join(root, '.piecemaker'));
  fs.mkdirSync(path.join(process.env.PIECEMAKER_HOME, 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(process.env.PIECEMAKER_HOME, 'decisions', 'JURITEXT000000000001.json'), '{}');
  const client = scripted([{ content: 'Voir JURITEXT000000000001 et JURITEXT000000000002.' }], []);
  try {
    const box = delegateSubagents(toolbox([]), { cwd: root, userHome: root, client, fallbackModel: 'mistral-medium-latest', signal: new AbortController().signal, authorize: allow });
    const report = String(await box.tools.get('research_maker')!.execute({ task: 'Durée du bail commercial ?' }));
    assert.match(report, /^Voir JURITEXT000000000001 et JURITEXT000000000002\./);
    assert.match(report, /jamais lues par consulter_decision : 1/);
    assert.match(report, /- JURITEXT000000000002/);
    assert.match(report, /Relancez le sous-agent research-maker/);
  } finally {
    if (previous === undefined) delete process.env.PIECEMAKER_HOME;
    else process.env.PIECEMAKER_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
