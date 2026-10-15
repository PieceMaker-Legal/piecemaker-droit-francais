import type { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';

import { buildCodexClientOptions } from './codex-options.js';
import { applyWorkspaceSkillVisibility, disabledSkillName, installedNames } from './skill-visibility.js';
import type { createLibraryStore } from './store.js';

const OPEN = '<PIECEMAKER_LIBRARY_INSTRUCTIONS>';
const CLOSE = '</PIECEMAKER_LIBRARY_INSTRUCTIONS>';

export function stripLibraryInstructions(text: string) {
  const start = text.lastIndexOf(`\n\n${OPEN}\n`);
  return start >= 0 && text.endsWith(CLOSE) ? text.slice(0, start) : text;
}

type LibraryDisabledSkill = { name: string; path: string };

function libraryDisabledSkills(store: ReturnType<typeof createLibraryStore>, cwd: string, provider: string) {
  applyWorkspaceSkillVisibility(store, cwd);
  const entries = store.disabledEntries(cwd);
  if (!entries.length) return [];
  const vibe = provider === 'mistral';
  const contents = vibe ? store.contents(entries.map((entry) => entry.id)) : null;
  const activeNames = vibe ? installedNames(store, cwd) : null;
  const disabled = new Map<string, LibraryDisabledSkill>();
  for (const entry of entries) {
    for (const file of entry.origins) {
      const name = contents ? disabledSkillName(contents.get(entry.id), file) : entry.name;
      if (activeNames?.has(name.toLowerCase()) || disabled.has(file)) continue;
      disabled.set(file, { name, path: file });
    }
  }
  return [...disabled.values()];
}

export function installLibraryRuntime(runtime: Pick<typeof providerRuntimeService, 'run' | 'getRunner'>, sessions: Pick<typeof sessionsService, 'fetchHistory'>, store: ReturnType<typeof createLibraryStore>) {
  const run = runtime.run.bind(runtime);
  const history = sessions.fetchHistory.bind(sessions);
  runtime.run = async (provider, command, options, writer) => {
    const cwd = String(options.cwd ?? options.projectPath ?? '');
    if (cwd) {
      try {
        const disabled = libraryDisabledSkills(store, cwd, String(provider));
        options = {
          ...options,
          ...(disabled.length ? { libraryDisabledSkills: disabled } : {}),
          libraryCodexOptions: buildCodexClientOptions(disabled),
        };
      } catch (error) {
        console.warn(`[bibliothèque] ${cwd} : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return run(provider, command, options, writer);
  };
  runtime.getRunner = (provider) => (command, options, writer) => runtime.run(provider, command, options, writer);
  sessions.fetchHistory = async (...args) => {
    const result = await history(...args);
    return { ...result, messages: result.messages.map((message) => message.kind === 'text' && message.role === 'user'
      ? { ...message, content: stripLibraryInstructions(message.content ?? '') } : message) };
  };
}
