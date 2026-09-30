import fs from 'node:fs';

import type { providerRuntimeService, providerSkillsService, sessionsService } from '@/modules/providers/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

import { splitLibraryHiddenSkills } from './skill-visibility.js';
import type { createLibraryStore } from './store.js';

const OPEN = '<PIECEMAKER_LIBRARY_INSTRUCTIONS>';
const CLOSE = '</PIECEMAKER_LIBRARY_INSTRUCTIONS>';

// Providers qui découvrent nativement les skills installés dans le dossier (.claude/skills, .agents/skills)
export const NATIVE_SKILL_PROVIDERS: readonly string[] = ['claude', 'codex', 'cursor', 'opencode'];

function stripLibraryInstructions(text: string) {
  const start = text.lastIndexOf(`\n\n${OPEN}\n`);
  return start >= 0 && text.endsWith(CLOSE) ? text.slice(0, start) : text;
}

// Skills personnels de la bibliothèque non activés dans le dossier, transmis aux runtimes (ex. Codex) qui les masquent nativement.
export type LibraryDisabledSkill = { name: string; path: string };

type ListSkills = typeof providerSkillsService.listProviderSkills;

export function installLibraryRuntime(
  runtime: Pick<typeof providerRuntimeService, 'run' | 'getRunner'>,
  sessions: Pick<typeof sessionsService, 'fetchHistory'>,
  store: ReturnType<typeof createLibraryStore>,
  extras: { listSkills?: ListSkills } = {},
) {
  const run = runtime.run.bind(runtime);
  const history = sessions.fetchHistory.bind(sessions);
  runtime.run = async (provider, command, options, writer) => {
    const cwd = String(options.cwd ?? options.projectPath ?? '');
    let instructions = '';
    if (cwd) {
      try {
        instructions = store.instructions(cwd, { includeSkills: !NATIVE_SKILL_PROVIDERS.includes(String(provider)) });
      } catch (error) {
        console.warn(`[bibliothèque] instructions ignorées pour ${cwd} : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (cwd && extras.listSkills && store.isManagedWorkspace(cwd)) {
      try {
        const { hidden } = splitLibraryHiddenSkills(await extras.listSkills(String(provider), { workspacePath: cwd }), store, cwd);
        const disabled = new Map<string, LibraryDisabledSkill>();
        for (const skill of hidden) {
          try { const file = fs.realpathSync(skill.sourcePath as string); if (!disabled.has(file)) disabled.set(file, { name: skill.name, path: file }); } catch { /* chemin illisible : ignoré */ }
        }
        if (disabled.size) options = { ...options, libraryDisabledSkills: [...disabled.values()] };
      } catch (error) {
        console.warn(`[bibliothèque] skills masqués ignorés pour ${cwd} : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const wrapped = new Proxy(writer, {
      get(target, key) {
        if (key === 'send') return (value: unknown) => {
          const message = value as NormalizedMessage;
          target.send(message?.kind === 'text' && message.role === 'user'
            ? { ...message, content: stripLibraryInstructions(message.content ?? '') } : value);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return run(provider, instructions ? `${command}\n\n${OPEN}\nInstructions activées pour ce dossier, à appliquer lorsqu’elles concernent la demande.\n${instructions}\n${CLOSE}` : command, options, wrapped);
  };
  runtime.getRunner = (provider) => (command, options, writer) => runtime.run(provider, command, options, writer);
  sessions.fetchHistory = async (...args) => {
    const result = await history(...args);
    return { ...result, messages: result.messages.map((message) => message.kind === 'text' && message.role === 'user'
      ? { ...message, content: stripLibraryInstructions(message.content ?? '') } : message) };
  };
}
