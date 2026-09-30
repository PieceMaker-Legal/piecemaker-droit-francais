import type { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

import { applyWorkspaceSkillVisibility, disabledSkillName, installedNames } from './skill-visibility.js';
import type { createLibraryStore } from './store.js';

const OPEN = '<PIECEMAKER_LIBRARY_INSTRUCTIONS>';
const CLOSE = '</PIECEMAKER_LIBRARY_INSTRUCTIONS>';

// Providers qui découvrent nativement les skills installés dans le dossier (.claude/skills, .agents/skills)
export const NATIVE_SKILL_PROVIDERS: readonly string[] = ['claude', 'codex', 'cursor', 'opencode', 'mistral'];

function stripLibraryInstructions(text: string) {
  const start = text.lastIndexOf(`\n\n${OPEN}\n`);
  return start >= 0 && text.endsWith(CLOSE) ? text.slice(0, start) : text;
}

// Skills désactivés dans le dossier, transmis aux runtimes (Codex, Vibe) qui les masquent nativement.
export type LibraryDisabledSkill = { name: string; path: string };

export function installLibraryRuntime(
  runtime: Pick<typeof providerRuntimeService, 'run' | 'getRunner'>,
  sessions: Pick<typeof sessionsService, 'fetchHistory'>,
  store: ReturnType<typeof createLibraryStore>,
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
    if (cwd) {
      try {
        store.reconcileWorkspace(cwd);
        applyWorkspaceSkillVisibility(store, cwd);
        const disabled = new Map<string, LibraryDisabledSkill>();
        const entries = store.disabledEntries(cwd);
        const isVibe = String(provider) === 'mistral';
        const contents = isVibe ? store.contents(entries.map((entry) => entry.id)) : null;
        // Vibe masque par nom : un nom identique à celui d'un skill actif dans le dossier masquerait aussi la copie active.
        const activeNames = isVibe && entries.length ? installedNames(store, cwd) : null;
        for (const entry of entries) {
          for (const file of entry.origins) {
            const name = contents ? disabledSkillName(contents.get(entry.id), file) : entry.name;
            if (activeNames?.has(name.toLowerCase()) || disabled.has(file)) continue;
            disabled.set(file, { name, path: file });
          }
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
