'use strict';

/**
 * Serveurs MCP Codex, lus et écrits en TOML (`@iarna/toml`, déjà une
 * dépendance du dépôt). Miroir manuel des formes de `codex-mcp.provider.ts`,
 * jamais un import de ce fichier. `enabled` vient du fichier projet quand il
 * définit le serveur, sinon vaut `true` par défaut.
 */
const fs = require('node:fs');
const path = require('node:path');

const TOML = require('@iarna/toml');

const { displayPath } = require('./paths.cjs');

function readTomlSafe(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = TOML.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeTomlSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, TOML.stringify(data), 'utf8');
}

function codexConfigPath(root) {
  return path.join(root, '.codex', 'config.toml');
}

function serversOf(config) {
  return config.mcp_servers && typeof config.mcp_servers === 'object' ? config.mcp_servers : {};
}

function describeServer(config) {
  if (!config || typeof config !== 'object') return undefined;
  if (typeof config.command === 'string') {
    const args = Array.isArray(config.args) ? config.args.join(' ') : '';
    return args ? `${config.command} ${args}` : config.command;
  }
  return undefined;
}

function listCodexMcp(workspacePath, userHome) {
  const userConfig = readTomlSafe(codexConfigPath(userHome));
  const projectConfig = readTomlSafe(codexConfigPath(workspacePath));
  const userServers = serversOf(userConfig);
  const projectServers = serversOf(projectConfig);

  const byName = new Map();
  for (const [name, config] of Object.entries(projectServers)) {
    byName.set(name, {
      id: name,
      name,
      description: describeServer(config),
      origin: 'project',
      source: displayPath(codexConfigPath(workspacePath), userHome),
      enabled: config?.enabled !== false,
      toggleable: true,
    });
  }
  for (const [name, config] of Object.entries(userServers)) {
    if (byName.has(name)) continue;
    byName.set(name, {
      id: name,
      name,
      description: describeServer(config),
      origin: 'user',
      source: displayPath(codexConfigPath(userHome), userHome),
      enabled: config?.enabled !== false,
      toggleable: true,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function toggleCodexMcp(workspacePath, userHome, name, enabled) {
  const projectPath = codexConfigPath(workspacePath);
  const projectConfig = readTomlSafe(projectPath);
  const projectServers = serversOf(projectConfig);

  let entry = projectServers[name];
  if (!entry) {
    const userServers = serversOf(readTomlSafe(codexConfigPath(userHome)));
    entry = userServers[name] ? { ...userServers[name] } : {};
  } else {
    entry = { ...entry };
  }
  entry.enabled = enabled;
  projectServers[name] = entry;
  projectConfig.mcp_servers = projectServers;
  writeTomlSafe(projectPath, projectConfig);

  return listCodexMcp(workspacePath, userHome).find((item) => item.id === name)
    ?? { id: name, name, origin: 'project', source: displayPath(projectPath, userHome), enabled, toggleable: true };
}

module.exports = { listCodexMcp, toggleCodexMcp, codexConfigPath };
