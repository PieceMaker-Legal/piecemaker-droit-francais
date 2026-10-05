import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { normalizeProviderConnector, opencodeConfigPath, prepareConnectorInstallation, type LibraryConnectorConfig } from './library/connector-installation.js';
import { readJson, readToml } from './library/provider-connectors.js';

const SERVER_NAME = 'piecemaker';

function pieceMakerServerConfig(): LibraryConnectorConfig {
  const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
  return {
    transport: 'stdio',
    command: 'node',
    args: [path.join(applicationRoot, 'server', 'piecemaker', 'vendor', 'mcp', 'piecemaker', 'server.mjs')],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function matches(raw: unknown, expected: LibraryConnectorConfig): boolean {
  const found = normalizeProviderConnector(raw);
  return found?.transport === 'stdio'
    && found.command === expected.command
    && JSON.stringify(found.args) === JSON.stringify(expected.args);
}

function isDeclared(workspace: string, expected: LibraryConnectorConfig): boolean {
  const vibeServers = readToml(path.join(workspace, '.vibe', 'config.toml')).mcp_servers;
  return [
    record(record(readToml(path.join(workspace, '.codex', 'config.toml'))).mcp_servers)[SERVER_NAME],
    record(record(readToml(path.join(workspace, '.grok', 'config.toml'))).mcp_servers)[SERVER_NAME],
    record(record(readJson(path.join(workspace, '.cursor', 'mcp.json'))).mcpServers)[SERVER_NAME],
    record(record(readJson(opencodeConfigPath(workspace))).mcp)[SERVER_NAME],
    (Array.isArray(vibeServers) ? vibeServers : []).find((server) => record(server).name === SERVER_NAME),
  ].every((raw) => matches(raw, expected));
}

export function declarePieceMakerServer(workspace: string): void {
  try {
    const config = pieceMakerServerConfig();
    if (isDeclared(workspace, config)) return;
    prepareConnectorInstallation(workspace, SERVER_NAME, config, true, true)();
  } catch (error) {
    console.warn(`[piecemaker] déclaration du serveur MCP impossible dans ${workspace} : ${error instanceof Error ? error.message : String(error)}`);
  }
}
