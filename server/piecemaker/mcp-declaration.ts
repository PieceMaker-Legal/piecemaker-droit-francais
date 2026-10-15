import fs from 'node:fs';
import { createRequire } from 'node:module';
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

const TOML = createRequire(import.meta.url)('@iarna/toml') as { stringify(value: Record<string, unknown>): string };

const CODEX_TOOLS_APPROVAL = 'approve';

const BUNDLED_SERVERS = [
  { name: 'legifrance', skipClaude: false },
] as const;

const RETIRED_SERVERS = ['piecemaker'] as const;

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

function approveCodexTools(workspace: string): void {
  const codexPath = path.join(workspace, '.codex', 'config.toml');
  const config = record(readToml(codexPath));
  const servers = record(config.mcp_servers);
  const pending = BUNDLED_SERVERS
    .map(({ name }) => name)
    .filter((name) => name in servers && record(servers[name]).default_tools_approval_mode !== CODEX_TOOLS_APPROVAL);
  if (pending.length === 0) return;
  for (const name of pending) servers[name] = { ...record(servers[name]), default_tools_approval_mode: CODEX_TOOLS_APPROVAL };
  fs.writeFileSync(codexPath, TOML.stringify({ ...config, mcp_servers: servers }), { mode: 0o600 });
}

function writeJsonFile(filePath: string, value: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function deleteKey(container: Record<string, unknown>, name: string) {
  if (!(name in container)) return false;
  delete container[name];
  return true;
}

function removeRetiredServers(workspace: string): void {
  for (const name of RETIRED_SERVERS) {
    const jsonTargets: Array<{ file: string; key: string }> = [
      { file: path.join(workspace, '.mcp.json'), key: 'mcpServers' },
      { file: path.join(workspace, '.cursor', 'mcp.json'), key: 'mcpServers' },
      { file: opencodeConfigPath(workspace), key: 'mcp' },
    ];
    for (const { file, key } of jsonTargets) {
      if (!fs.existsSync(file)) continue;
      const document = record(readJson(file));
      const servers = record(document[key]);
      if (!deleteKey(servers, name)) continue;
      writeJsonFile(file, { ...document, [key]: servers });
    }
    for (const relative of ['.codex/config.toml', '.grok/config.toml']) {
      const file = path.join(workspace, relative);
      if (!fs.existsSync(file)) continue;
      const document = record(readToml(file));
      const servers = record(document.mcp_servers);
      if (!deleteKey(servers, name)) continue;
      fs.writeFileSync(file, TOML.stringify({ ...document, mcp_servers: servers }), { mode: 0o600 });
    }
    const vibePath = path.join(workspace, '.vibe', 'config.toml');
    if (fs.existsSync(vibePath)) {
      const document = record(readToml(vibePath));
      const servers = Array.isArray(document.mcp_servers) ? document.mcp_servers : [];
      const next = servers.filter((server) => record(server).name !== name);
      if (next.length !== servers.length) {
        fs.writeFileSync(vibePath, TOML.stringify({ ...document, mcp_servers: next }), { mode: 0o600 });
      }
    }
    const claudeSettingsPath = path.join(workspace, '.claude', 'settings.local.json');
    if (fs.existsSync(claudeSettingsPath)) {
      const settings = record(readJson(claudeSettingsPath));
      const disabled = Array.isArray(settings.disabledMcpServers) ? settings.disabledMcpServers : [];
      const next = disabled.filter((entry) => entry !== name);
      if (next.length !== disabled.length) writeJsonFile(claudeSettingsPath, { ...settings, disabledMcpServers: next });
    }
  }
}

function retiredServersGone(workspace: string): boolean {
  return RETIRED_SERVERS.every((name) => {
    const vibeServers = readToml(path.join(workspace, '.vibe', 'config.toml')).mcp_servers;
    const found = [
      record(record(readToml(path.join(workspace, '.codex', 'config.toml'))).mcp_servers)[name],
      record(record(readToml(path.join(workspace, '.grok', 'config.toml'))).mcp_servers)[name],
      record(record(readJson(path.join(workspace, '.cursor', 'mcp.json'))).mcpServers)[name],
      record(record(readJson(opencodeConfigPath(workspace))).mcp)[name],
      record(record(readJson(path.join(workspace, '.mcp.json'))).mcpServers)[name],
      (Array.isArray(vibeServers) ? vibeServers : []).find((server) => record(server).name === name),
    ];
    return found.every((raw) => raw === undefined);
  });
}

export function declarePieceMakerServer(workspace: string): void {
  try {
    if (!retiredServersGone(workspace)) removeRetiredServers(workspace);
    for (const server of BUNDLED_SERVERS) {
      const config = vendorMcpServer(server.name);
      if (isDeclared(workspace, server.name, config, server.skipClaude)) continue;
      prepareConnectorInstallation(workspace, server.name, config, true, server.skipClaude)();
    }
    approveCodexTools(workspace);
  } catch (error) {
    console.warn(`[piecemaker] déclaration du serveur MCP impossible dans ${workspace} : ${error instanceof Error ? error.message : String(error)}`);
  }
}
