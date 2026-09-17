import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { normalizeProviderConnector, type LibraryConnectorConfig } from './connector-installation.js';
import type { createLibraryStore } from './store.js';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml') as { parse(value: string): Record<string, unknown> };

export const REGISTRE_PUBLIC_CONNECTOR = Object.freeze({
  name: 'registre-public',
  url: 'https://registre-public.com/api/mcp',
});

type ImportedConnector = {
  name: string;
  description: string;
  config: LibraryConnectorConfig;
  source: string;
};

function readJson(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readToml(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const value = TOML.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function objectRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function collectServers(source: string, servers: Record<string, unknown>, collected: ImportedConnector[]) {
  for (const [name, raw] of Object.entries(servers)) {
    const config = normalizeProviderConnector(raw);
    if (!config) continue;
    collected.push({
      name,
      description: config.url || config.command || name,
      config,
      source: `${source}#${name}`,
    });
  }
}

export function listUserProviderConnectors(userHome: string) {
  const collected: ImportedConnector[] = [];
  collectServers(path.join(userHome, '.claude.json'), objectRecord(readJson(path.join(userHome, '.claude.json')).mcpServers), collected);
  collectServers(path.join(userHome, '.codex', 'config.toml'), objectRecord(readToml(path.join(userHome, '.codex', 'config.toml')).mcp_servers), collected);
  collectServers(path.join(userHome, '.cursor', 'mcp.json'), objectRecord(readJson(path.join(userHome, '.cursor', 'mcp.json')).mcpServers), collected);
  const opencodeJson = path.join(userHome, '.config', 'opencode', 'opencode.json');
  const opencodeJsonc = path.join(userHome, '.config', 'opencode', 'opencode.jsonc');
  const opencodePath = fs.existsSync(opencodeJson) ? opencodeJson : opencodeJsonc;
  collectServers(opencodePath, objectRecord(readJson(opencodePath).mcp), collected);
  return collected;
}

export function seedDefaultLibraryConnectors(store: ReturnType<typeof createLibraryStore>) {
  return store.importConnector({
    name: REGISTRE_PUBLIC_CONNECTOR.name,
    description: REGISTRE_PUBLIC_CONNECTOR.url,
    config: { transport: 'http', url: REGISTRE_PUBLIC_CONNECTOR.url },
    source: 'piecemaker:default:registre-public',
  });
}

export function scanAndPersistLibraryProviderConnectors(store: ReturnType<typeof createLibraryStore>, userHome: string) {
  seedDefaultLibraryConnectors(store);
  const imported: string[] = [];
  for (const connector of listUserProviderConnectors(userHome)) {
    try { imported.push(store.importConnector(connector)); } catch {}
  }
  return imported;
}
