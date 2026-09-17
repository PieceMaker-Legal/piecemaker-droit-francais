import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml') as {
  parse(value: string): Record<string, unknown>;
  stringify(value: Record<string, unknown>): string;
};

export type LibraryConnectorConfig = {
  transport: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

type FileSnapshot = { filePath: string; previous: string | null };

function readJson(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readToml(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  const value = TOML.parse(fs.readFileSync(filePath, 'utf8'));
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function writeJson(filePath: string, value: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeToml(filePath: string, value: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, TOML.stringify(value), { mode: 0o600 });
}

function snapshotFile(filePath: string): FileSnapshot {
  return { filePath, previous: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null };
}

function restoreFile({ filePath, previous }: FileSnapshot) {
  if (previous === null) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, previous, { mode: 0o600 });
}

function assertWorkspaceFile(workspace: string, filePath: string) {
  const resolvedWorkspace = fs.realpathSync(workspace);
  const parent = path.dirname(filePath);
  if (fs.existsSync(parent)) {
    const resolvedParent = fs.realpathSync(parent);
    if (resolvedParent !== resolvedWorkspace && !resolvedParent.startsWith(resolvedWorkspace + path.sep)) {
      throw new Error(`Répertoire de composants hors du dossier : ${parent}`);
    }
  } else if (!parent.startsWith(resolvedWorkspace + path.sep) && parent !== resolvedWorkspace) {
    throw new Error(`Répertoire de composants hors du dossier : ${parent}`);
  }
}

function objectRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function claudeServer(config: LibraryConnectorConfig) {
  if (config.transport === 'http') {
    return {
      type: 'http',
      url: config.url,
      ...(config.headers && Object.keys(config.headers).length ? { headers: config.headers } : {}),
    };
  }
  return {
    type: 'stdio',
    command: config.command,
    args: config.args ?? [],
    ...(config.env && Object.keys(config.env).length ? { env: config.env } : {}),
  };
}

function cursorServer(config: LibraryConnectorConfig, enabled: boolean) {
  const server = config.transport === 'http'
    ? { url: config.url, ...(config.headers && Object.keys(config.headers).length ? { headers: config.headers } : {}) }
    : { command: config.command, args: config.args ?? [], ...(config.env && Object.keys(config.env).length ? { env: config.env } : {}) };
  return enabled ? server : { ...server, disabled: true };
}

function codexServer(config: LibraryConnectorConfig, enabled: boolean) {
  if (config.transport === 'http') {
    return {
      url: config.url,
      enabled,
      ...(config.headers && Object.keys(config.headers).length ? { http_headers: config.headers } : {}),
    };
  }
  return {
    command: config.command,
    args: config.args ?? [],
    enabled,
    ...(config.env && Object.keys(config.env).length ? { env: config.env } : {}),
  };
}

function grokServer(config: LibraryConnectorConfig, enabled: boolean) {
  if (config.transport === 'http') {
    return {
      url: config.url,
      enabled,
      ...(config.headers && Object.keys(config.headers).length ? { headers: config.headers } : {}),
    };
  }
  return {
    command: config.command,
    args: config.args ?? [],
    enabled,
    ...(config.env && Object.keys(config.env).length ? { env: config.env } : {}),
  };
}

function opencodeServer(config: LibraryConnectorConfig, enabled: boolean) {
  if (config.transport === 'http') {
    return {
      type: 'remote',
      url: config.url,
      enabled,
      ...(config.headers && Object.keys(config.headers).length ? { headers: config.headers } : {}),
    };
  }
  return {
    type: 'local',
    command: [config.command, ...(config.args ?? [])].filter(Boolean),
    enabled,
    ...(config.env && Object.keys(config.env).length ? { environment: config.env } : {}),
  };
}

function opencodeConfigPath(workspace: string) {
  const jsonPath = path.join(workspace, 'opencode.json');
  const jsoncPath = path.join(workspace, 'opencode.jsonc');
  if (fs.existsSync(jsonPath)) return jsonPath;
  if (fs.existsSync(jsoncPath)) return jsoncPath;
  return jsonPath;
}

export function parseConnectorConfig(content: string): LibraryConnectorConfig {
  const parsed = JSON.parse(content) as LibraryConnectorConfig;
  if (parsed?.transport !== 'http' && parsed?.transport !== 'stdio') throw new Error('Connecteur invalide.');
  if (parsed.transport === 'http' && typeof parsed.url !== 'string') throw new Error('Connecteur invalide.');
  if (parsed.transport === 'stdio' && typeof parsed.command !== 'string') throw new Error('Connecteur invalide.');
  return parsed;
}

export function normalizeProviderConnector(raw: unknown): LibraryConnectorConfig | null {
  const config = objectRecord(raw);
  if (typeof config.url === 'string' || config.type === 'http' || config.type === 'remote' || config.type === 'sse') {
    const url = typeof config.url === 'string' ? config.url : '';
    if (!url) return null;
    const headers = { ...objectRecord(config.headers), ...objectRecord(config.http_headers) };
    return {
      transport: 'http',
      url,
      headers: Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    };
  }
  const commandParts = typeof config.command === 'string'
    ? [config.command, ...(Array.isArray(config.args) ? config.args.filter((value): value is string => typeof value === 'string') : [])]
    : Array.isArray(config.command) ? config.command.filter((value): value is string => typeof value === 'string') : [];
  if (!commandParts[0]) return null;
  const env = { ...objectRecord(config.env), ...objectRecord(config.environment) };
  return {
    transport: 'stdio',
    command: commandParts[0],
    args: commandParts.slice(1),
    env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  };
}

export function prepareConnectorInstallation(workspace: string, name: string, config: LibraryConnectorConfig, enabled: boolean) {
  const mcpJsonPath = path.join(workspace, '.mcp.json');
  const claudeSettingsPath = path.join(workspace, '.claude', 'settings.local.json');
  const codexPath = path.join(workspace, '.codex', 'config.toml');
  const cursorPath = path.join(workspace, '.cursor', 'mcp.json');
  const opencodePath = opencodeConfigPath(workspace);
  const grokPath = path.join(workspace, '.grok', 'config.toml');
  for (const filePath of [mcpJsonPath, claudeSettingsPath, codexPath, cursorPath, opencodePath, grokPath]) {
    assertWorkspaceFile(workspace, filePath);
  }

  const snapshots = [mcpJsonPath, claudeSettingsPath, codexPath, cursorPath, opencodePath, grokPath].map(snapshotFile);

  return () => {
    try {
      const mcpJson = readJson(mcpJsonPath);
      const mcpServers = objectRecord(mcpJson.mcpServers);
      if (enabled) mcpServers[name] = claudeServer(config);
      else delete mcpServers[name];
      mcpJson.mcpServers = mcpServers;
      writeJson(mcpJsonPath, mcpJson);

      const claudeSettings = readJson(claudeSettingsPath);
      const disabled = Array.isArray(claudeSettings.disabledMcpServers)
        ? claudeSettings.disabledMcpServers.filter((entry) => entry !== name)
        : [];
      claudeSettings.disabledMcpServers = enabled ? disabled : [...disabled, name];
      writeJson(claudeSettingsPath, claudeSettings);

      const codexConfig = readToml(codexPath);
      const codexServers = objectRecord(codexConfig.mcp_servers);
      codexServers[name] = enabled
        ? codexServer(config, true)
        : { ...objectRecord(codexServers[name]), ...codexServer(config, false), enabled: false };
      codexConfig.mcp_servers = codexServers;
      writeToml(codexPath, codexConfig);

      const cursorConfig = readJson(cursorPath);
      const cursorServers = objectRecord(cursorConfig.mcpServers);
      cursorServers[name] = cursorServer(config, enabled);
      cursorConfig.mcpServers = cursorServers;
      writeJson(cursorPath, cursorConfig);

      const opencodeConfig = readJson(opencodePath);
      const opencodeServers = objectRecord(opencodeConfig.mcp);
      opencodeServers[name] = opencodeServer(config, enabled);
      opencodeConfig.mcp = opencodeServers;
      writeJson(opencodePath, opencodeConfig);

      const grokConfig = readToml(grokPath);
      const grokServers = objectRecord(grokConfig.mcp_servers);
      grokServers[name] = enabled
        ? grokServer(config, true)
        : { ...objectRecord(grokServers[name]), ...grokServer(config, false), enabled: false };
      grokConfig.mcp_servers = grokServers;
      writeToml(grokPath, grokConfig);
    } catch (error) {
      for (const snapshot of snapshots.reverse()) restoreFile(snapshot);
      throw error;
    }
  };
}
