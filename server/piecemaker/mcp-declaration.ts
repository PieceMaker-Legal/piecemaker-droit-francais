import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { normalizeProviderConnector, opencodeConfigPath, prepareConnectorInstallation, type LibraryConnectorConfig } from './library/connector-installation.js';
import { readJson, readToml } from './library/provider-connectors.js';

function vendorMcpServer(name: string): LibraryConnectorConfig {
  const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
  return {
    transport: 'stdio',
    command: 'node',
    args: [path.join(applicationRoot, 'server', 'piecemaker', 'vendor', 'mcp', name, 'server.mjs')],
  };
}

const BUNDLED_SERVERS = [
  { name: 'piecemaker', skipClaude: true },
  { name: 'legifrance', skipClaude: false },
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function matches(raw: unknown, expected: LibraryConnectorConfig): boolean {
  const found = normalizeProviderConnector(raw);
  return found?.transport === 'stdio'
    && found.command === expected.command
    && JSON.stringify(found.args) === JSON.stringify(expected.args);
}

function isDeclared(workspace: string, name: string, expected: LibraryConnectorConfig, skipClaude: boolean): boolean {
  const vibeServers = readToml(path.join(workspace, '.vibe', 'config.toml')).mcp_servers;
  const found = [
    record(record(readToml(path.join(workspace, '.codex', 'config.toml'))).mcp_servers)[name],
    record(record(readToml(path.join(workspace, '.grok', 'config.toml'))).mcp_servers)[name],
    record(record(readJson(path.join(workspace, '.cursor', 'mcp.json'))).mcpServers)[name],
    record(record(readJson(opencodeConfigPath(workspace))).mcp)[name],
    (Array.isArray(vibeServers) ? vibeServers : []).find((server) => record(server).name === name),
  ];
  if (!skipClaude) found.push(record(record(readJson(path.join(workspace, '.mcp.json'))).mcpServers)[name]);
  return found.every((raw) => matches(raw, expected));
}

export function declarePieceMakerServer(workspace: string): void {
  try {
    for (const server of BUNDLED_SERVERS) {
      const config = vendorMcpServer(server.name);
      if (isDeclared(workspace, server.name, config, server.skipClaude)) continue;
      prepareConnectorInstallation(workspace, server.name, config, true, server.skipClaude)();
    }
  } catch (error) {
    console.warn(`[piecemaker] déclaration du serveur MCP impossible dans ${workspace} : ${error instanceof Error ? error.message : String(error)}`);
  }
}
