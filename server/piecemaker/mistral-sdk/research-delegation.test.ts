import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { reserveLegalSearch } from './research-delegation.js';

const definition = (name: string) => ({ type: 'function' as const, function: { name, parameters: { type: 'object' } } });

function toolbox(calls: string[]) {
  const tool = (name: string, readOnly = true) => [name, { name, readOnly, definition: definition(name), execute: async (input: Record<string, unknown>) => { calls.push(`${name}:${JSON.stringify(input)}`); return `résultat ${name}`; } }] as const;
  return { instructions: 'Skills disponibles', close: async () => {}, tools: new Map([
    tool('mcp__legifrance__Search_Jurisprudence'), tool('mcp__legifrance__consulter_article'), tool('Read'), tool('Write', false),
  ]) };
}

function workspace(withAgent: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-research-'));
  if (withAgent) {
    fs.mkdirSync(path.join(root, '.vibe', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.vibe', 'agents', 'research-maker.toml'), 'display_name = "research-maker"\nactive_model = "mistral-small"\ninstructions = "Méthode de recherche fictive."\n');
  }
  return root;
}

test('keeps Légifrance searches for the main agent when research-maker is not installed', () => {
  const root = workspace(false);
  try {
    const box = reserveLegalSearch(toolbox([]), { cwd: root, userHome: root, client: { chat: { complete: async () => ({}) } }, fallbackModel: 'mistral-medium-latest', signal: new AbortController().signal });
    assert.ok(box.tools.has('mcp__legifrance__Search_Jurisprudence'));
    assert.equal(box.tools.has('research_maker'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reserves Légifrance searches to a delegated research-maker loop', async () => {
  const root = workspace(true);
  const calls: string[] = [];
  const requests: Array<{ model: string; tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown }> }> = [];
  const replies = [
    { toolCalls: [{ id: 'c1', function: { name: 'mcp__legifrance__Search_Jurisprudence', arguments: '{"query":"bail commercial"}' } }] },
    { toolCalls: [{ id: 'c2', function: { name: 'Write', arguments: '{}' } }] },
    { content: 'Compte rendu fictif.' },
  ];
  const client = { chat: { complete: async (request: never) => { requests.push(structuredClone(request)); return { choices: [{ message: replies.shift() }] }; } } };
  try {
    const box = reserveLegalSearch(toolbox(calls), { cwd: root, userHome: root, client, fallbackModel: 'mistral-medium-latest', signal: new AbortController().signal });
    assert.equal(box.tools.has('mcp__legifrance__Search_Jurisprudence'), false);
    assert.ok(box.tools.has('mcp__legifrance__consulter_article'));
    const delegate = box.tools.get('research_maker')!;
    assert.equal(delegate.readOnly, true);
    assert.match(box.instructions, /research_maker/);
    assert.equal(await delegate.execute({ question: 'Durée du bail commercial ?' }), 'Compte rendu fictif.');
    assert.deepEqual(calls, ['mcp__legifrance__Search_Jurisprudence:{"query":"bail commercial"}']);
    assert.equal(requests[0].model, 'mistral-small-latest');
    assert.deepEqual(requests[0].tools?.map(tool => tool.function.name).sort(), ['Read', 'mcp__legifrance__Search_Jurisprudence', 'mcp__legifrance__consulter_article']);
    assert.match(String(requests[0].messages[0].content), /Méthode de recherche fictive/);
    assert.match(String(requests[2].messages.at(-1)?.content), /indisponible/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
