import fs from 'node:fs';
import path from 'node:path';

import { listUserProviderConnectors } from './provider-connectors.js';

const GLOBAL_DIRECTORIES = [
  ['.claude/skills', 'Claude'],
  ['.claude/agents', 'Claude'],
  ['.codex/skills', 'Codex'],
  ['.codex/agents', 'Codex'],
  ['.agents/skills', 'Codex'],
  ['.cursor/skills', 'Cursor'],
  ['.cursor/agents', 'Cursor'],
  ['.config/opencode/skills', 'OpenCode'],
  ['.config/opencode/agent', 'OpenCode'],
  ['.config/opencode/agents', 'OpenCode'],
  ['.grok/skills', 'Grok'],
  ['.grok/agents', 'Grok'],
] as const;

const GLOBAL_CONNECTOR_FILES = [
  ['.claude.json', 'Claude'],
  ['.codex/config.toml', 'Codex'],
  ['.cursor/mcp.json', 'Cursor'],
  ['.config/opencode/opencode.json', 'OpenCode'],
  ['.config/opencode/opencode.jsonc', 'OpenCode'],
  ['.grok/config.toml', 'Grok'],
] as const;

export function globalProviderIndex(userHome: string) {
  const providers = new Map<string, Set<string>>();
  const record = (source: string, provider: string) => {
    providers.set(source, (providers.get(source) ?? new Set()).add(provider));
  };
  for (const [directory, provider] of GLOBAL_DIRECTORIES) {
    const root = path.join(userHome, directory);
    let children: string[];
    try { children = fs.readdirSync(root); } catch { continue; }
    for (const child of children) {
      for (const candidate of [path.join(root, child), path.join(root, child, 'SKILL.md')]) {
        try {
          if (!fs.statSync(candidate).isFile()) continue;
          record(candidate, provider);
          record(fs.realpathSync(candidate), provider);
        } catch {}
      }
    }
  }
  for (const connector of listUserProviderConnectors(userHome)) {
    const file = connector.source.slice(0, connector.source.lastIndexOf('#'));
    const match = GLOBAL_CONNECTOR_FILES.find(([name]) => path.join(userHome, name) === file);
    if (match) record(connector.source, match[1]);
  }
  return (sources: string[]) => [...new Set(sources.flatMap((source) => [...(providers.get(source) ?? [])]))].sort();
}
