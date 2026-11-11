import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ChatCompletionRequest } from '@mistralai/mistralai/models/components';

import { readToml } from '../library/provider-connectors.js';
import type { createMistralTools } from './tools.js';

type Toolbox = Awaited<ReturnType<typeof createMistralTools>>;
type ToolEntry = Toolbox['tools'] extends Map<string, infer T> ? T : never;
type CompletionClient = { chat: { complete(request: ChatCompletionRequest, options?: { signal?: AbortSignal }): Promise<{ choices?: Array<{ message?: { content?: unknown; toolCalls?: Array<{ id?: string | null; function: { name: string; arguments: unknown } }> | null } }> }> } };

const SEARCH_TOOL = /^mcp__.*legifrance.*__Search_/;
const RESEARCH_TOOL = /^mcp__.*legifrance.*__|^(Read|Grep|Glob)$/;
const MODELS: Record<string, string> = { 'mistral-small': 'mistral-small-latest', 'mistral-medium-3.5': 'mistral-medium-latest', 'glm-5.3': 'zai-glm-5-3', 'glm-5.2': 'zai-glm-5-2' };
const MAX_TURNS = 20;

export function mistralModelId(selected: string) {
  return MODELS[selected] || selected;
}

function researchAgent(cwd: string, userHome: string) {
  const file = [cwd, userHome].map(root => path.join(root, '.vibe', 'agents', 'research-maker.toml')).find(candidate => fs.existsSync(candidate));
  if (!file) return null;
  const agent = readToml(file) as { instructions?: unknown; active_model?: unknown };
  return { instructions: typeof agent.instructions === 'string' ? agent.instructions : '', model: typeof agent.active_model === 'string' ? mistralModelId(agent.active_model) : null };
}

function text(content: unknown) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(chunk => chunk?.type === 'text' ? String(chunk.text ?? '') : '').join('');
}

export function reserveLegalSearch(toolbox: Toolbox, { cwd, userHome = os.homedir(), client, fallbackModel, signal }: { cwd: string; userHome?: string; client: CompletionClient; fallbackModel: string; signal: AbortSignal }) {
  const searches = [...toolbox.tools.entries()].filter(([, tool]) => SEARCH_TOOL.test(tool.name));
  if (!searches.length) return toolbox;
  const agent = researchAgent(cwd, userHome);
  if (!agent) return toolbox;
  const research = new Map<string, ToolEntry>([...toolbox.tools.entries()].filter(([, tool]) => tool.readOnly && RESEARCH_TOOL.test(tool.name)));
  for (const [apiName] of searches) toolbox.tools.delete(apiName);
  const execute = async (input: Record<string, unknown>) => {
    const question = String(input.question ?? '').trim();
    if (!question) throw new Error('Question de recherche manquante.');
    const messages: ChatCompletionRequest['messages'] = [
      { role: 'system', content: `${agent.instructions}\n\nDossier courant : ${cwd}.` },
      { role: 'user', content: question },
    ];
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      signal.throwIfAborted();
      const completion = await client.chat.complete({ model: agent.model || fallbackModel, messages, tools: [...research.values()].map(tool => tool.definition) }, { signal });
      const message = completion.choices?.[0]?.message;
      const calls = message?.toolCalls ?? [];
      messages.push({ role: 'assistant', content: text(message?.content) || null, ...(calls.length ? { toolCalls: calls.map(call => ({ ...call, id: call.id ?? undefined, type: 'function' as const, function: { name: call.function.name, arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments) } })) } : {}) });
      if (!calls.length) return text(message?.content) || 'research-maker n’a rendu aucun compte rendu.';
      for (const call of calls) {
        const tool = research.get(call.function.name);
        let result: string;
        try {
          if (!tool) throw new Error('Outil indisponible pour research-maker.');
          result = await tool.execute(typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments as Record<string, unknown>);
        } catch (error) {
          result = error instanceof Error ? error.message : String(error);
        }
        messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id ?? undefined, content: result });
      }
    }
    throw new Error('Limite de tours atteinte par research-maker.');
  };
  toolbox.tools.set('research_maker', {
    name: 'research_maker', readOnly: true, execute,
    definition: { type: 'function', function: {
      name: 'research_maker',
      description: 'Délègue une question de droit au sous-agent research-maker, seul autorisé à lancer les recherches Légifrance (Search_*). Il rend un compte rendu sourcé ; relisez chaque source citée avec consulter_article ou consulter_decision.',
      parameters: { type: 'object', properties: { question: { type: 'string', description: 'Question de droit précise, avec les faits utiles.' } }, required: ['question'] },
    } },
  });
  toolbox.instructions = `${toolbox.instructions}\n\nRecherche Légifrance : appelez research_maker ; les outils Search_* lui sont réservés.`;
  return toolbox;
}
