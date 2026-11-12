import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ChatCompletionRequest } from '@mistralai/mistralai/models/components';

import { readToml } from '../library/provider-connectors.js';
import { subagentReport } from '../vendor/piecemaker-plugin/scripts/verify-subagent.mjs';
import type { createMistralTools } from './tools.js';

type Toolbox = Awaited<ReturnType<typeof createMistralTools>>;
type ToolEntry = Toolbox['tools'] extends Map<string, infer T> ? T : never;
type CompletionClient = { chat: { complete(request: ChatCompletionRequest, options?: { signal?: AbortSignal }): Promise<{ choices?: Array<{ message?: { content?: unknown; toolCalls?: Array<{ id?: string | null; function: { name: string; arguments: unknown } }> | null } }> }> } };
type Authorize = (tool: ToolEntry, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Subagent = { slug: string; description: string; instructions: string; model: string | null };

const SEARCH_TOOL = /^mcp__.*legifrance.*__Search_/;
const RESEARCH_TOOL = /^mcp__.*legifrance.*__|^(Read|Grep|Glob)$/;
const LEGAL_RESEARCHER = 'research-maker';
const MODELS: Record<string, string> = { 'mistral-small': 'mistral-small-latest', 'mistral-medium-3.5': 'mistral-medium-latest', 'glm-5.3': 'zai-glm-5-3', 'glm-5.2': 'zai-glm-5-2' };
const MAX_TURNS = 20;

export function mistralModelId(selected: string) {
  return MODELS[selected] || selected;
}

function subagents(cwd: string, userHome: string) {
  const found = new Map<string, Subagent>();
  for (const root of [cwd, userHome]) {
    const directory = path.join(root, '.vibe', 'agents');
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.toml')).sort()) {
      const slug = file.slice(0, -'.toml'.length);
      if (found.has(slug) || !/^[a-z0-9-]+$/.test(slug)) continue;
      const agent = readToml(path.join(directory, file)) as { description?: unknown; instructions?: unknown; active_model?: unknown; agent_type?: unknown };
      if (agent.agent_type !== undefined && agent.agent_type !== 'subagent') continue;
      if (typeof agent.instructions !== 'string' || !agent.instructions.trim()) continue;
      found.set(slug, {
        slug,
        description: typeof agent.description === 'string' ? agent.description : slug,
        instructions: agent.instructions,
        model: typeof agent.active_model === 'string' ? mistralModelId(agent.active_model) : null,
      });
    }
  }
  return [...found.values()];
}

function text(content: unknown) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(chunk => chunk?.type === 'text' ? String(chunk.text ?? '') : '').join('');
}

export function delegateSubagents(toolbox: Toolbox, { cwd, userHome = os.homedir(), client, fallbackModel, signal, authorize }: { cwd: string; userHome?: string; client: CompletionClient; fallbackModel: string; signal: AbortSignal; authorize: Authorize }) {
  const agents = subagents(cwd, userHome);
  if (!agents.length) return toolbox;
  const available = [...toolbox.tools.entries()];
  const reserveSearch = agents.some(agent => agent.slug === LEGAL_RESEARCHER);
  if (reserveSearch) for (const [apiName, tool] of available) if (SEARCH_TOOL.test(tool.name)) toolbox.tools.delete(apiName);
  const toolsFor = (agent: Subagent) => new Map(agent.slug === LEGAL_RESEARCHER
    ? available.filter(([, tool]) => tool.readOnly && RESEARCH_TOOL.test(tool.name))
    : available.filter(([, tool]) => !(reserveSearch && SEARCH_TOOL.test(tool.name))));
  const delegates: string[] = [];
  for (const agent of agents) {
    const tools = toolsFor(agent);
    const name = agent.slug.replaceAll('-', '_');
    const execute = async (input: Record<string, unknown>) => {
      const task = String(input.task ?? input.question ?? '').trim();
      if (!task) throw new Error(`Tâche manquante pour ${agent.slug}.`);
      const messages: ChatCompletionRequest['messages'] = [
        { role: 'system', content: `${agent.instructions}\n\nDossier courant : ${cwd}.` },
        { role: 'user', content: task },
      ];
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        signal.throwIfAborted();
        const completion = await client.chat.complete({ model: agent.model || fallbackModel, messages, ...(tools.size ? { tools: [...tools.values()].map(tool => tool.definition) } : {}) }, { signal });
        const message = completion.choices?.[0]?.message;
        const calls = message?.toolCalls ?? [];
        messages.push({ role: 'assistant', content: text(message?.content) || null, ...(calls.length ? { toolCalls: calls.map(call => ({ ...call, id: call.id ?? undefined, type: 'function' as const, function: { name: call.function.name, arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments) } })) } : {}) });
        if (!calls.length) {
          const report = text(message?.content) || `${agent.slug} n’a rendu aucun compte rendu.`;
          const checked = await subagentReport({ tool_name: 'Agent', tool_input: { subagent_type: agent.slug }, tool_response: report, cwd });
          return checked?.hookSpecificOutput?.additionalContext ? `${report}\n\n${checked.hookSpecificOutput.additionalContext}` : report;
        }
        for (const call of calls) {
          const tool = tools.get(call.function.name);
          let result: string;
          try {
            if (!tool) throw new Error(`Outil indisponible pour ${agent.slug}.`);
            const parsed = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments as Record<string, unknown>;
            result = await tool.execute(await authorize(tool, parsed));
          } catch (error) {
            result = error instanceof Error ? error.message : String(error);
          }
          messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id ?? undefined, content: result });
        }
      }
      throw new Error(`Limite de tours atteinte par ${agent.slug}.`);
    };
    const reserved = agent.slug === LEGAL_RESEARCHER && reserveSearch ? ' Seul autorisé à lancer les recherches Légifrance (Search_*) ; relisez chaque source citée avec consulter_article ou consulter_decision.' : '';
    toolbox.tools.set(name, {
      name, readOnly: true, execute,
      definition: { type: 'function', function: {
        name,
        description: `Délègue au sous-agent ${agent.slug}. ${agent.description}${reserved} Il rend un compte rendu ; lisez-le et vérifiez-le.`,
        parameters: { type: 'object', properties: { task: { type: 'string', description: 'Tâche précise, avec les faits et fichiers utiles.' } }, required: ['task'] },
      } },
    });
    delegates.push(name);
  }
  toolbox.instructions = `${toolbox.instructions}\n\nSous-agents disponibles : ${delegates.join(', ')}. Confiez-leur les tâches qu’ils décrivent.${reserveSearch ? ' Recherche Légifrance : appelez research_maker ; les outils Search_* lui sont réservés.' : ''}`;
  return toolbox;
}
