'use strict';

/**
 * Serveurs MCP Claude Code visibles pour un dossier : union de la portée
 * utilisateur et des deux portées projet (`~/.claude.json` → `projects[...]`
 * et `<dossier>/.mcp.json`), sans importer `claude-mcp.provider.ts` — les
 * formes lues ici en sont la copie manuelle, jamais l'inverse.
 *
 * L'état activé/désactivé vient de `disabledMcpServers`, fusionné depuis les
 * trois fichiers de réglages Claude Code (global, projet partagé, projet
 * local) : la bascule n'écrit que le fichier local, mais la lecture doit
 * refléter une désactivation posée à n'importe quel niveau.
 */
const fs = require('node:fs');
const path = require('node:path');

const { displayPath } = require('./paths.cjs');

function readJsonSafe(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonPretty(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function claudeSettingsLocalPath(workspacePath) {
  return path.join(workspacePath, '.claude', 'settings.local.json');
}

function readMergedDisabledMcpServers(workspacePath, userHome) {
  const disabled = new Set();
  const files = [
    path.join(userHome, '.claude', 'settings.json'),
    path.join(workspacePath, '.claude', 'settings.json'),
    claudeSettingsLocalPath(workspacePath),
  ];
  for (const filePath of files) {
    const settings = readJsonSafe(filePath);
    if (Array.isArray(settings.disabledMcpServers)) {
      for (const name of settings.disabledMcpServers) disabled.add(name);
    }
  }
  return disabled;
}

function describeServer(config) {
  if (!config || typeof config !== 'object') return undefined;
  if (typeof config.command === 'string') {
    const args = Array.isArray(config.args) ? config.args.join(' ') : '';
    return args ? `${config.command} ${args}` : config.command;
  }
  if (typeof config.url === 'string') return config.url;
  return undefined;
}

function listClaudeMcp(workspacePath, userHome) {
  const userConfig = readJsonSafe(path.join(userHome, '.claude.json'));
  const userServers = userConfig.mcpServers && typeof userConfig.mcpServers === 'object' ? userConfig.mcpServers : {};
  const projects = userConfig.projects && typeof userConfig.projects === 'object' ? userConfig.projects : {};
  const projectEntry = projects[workspacePath] && typeof projects[workspacePath] === 'object' ? projects[workspacePath] : {};
  const projectScopedServers = projectEntry.mcpServers && typeof projectEntry.mcpServers === 'object' ? projectEntry.mcpServers : {};
  const mcpJsonConfig = readJsonSafe(path.join(workspacePath, '.mcp.json'));
  const mcpJsonServers = mcpJsonConfig.mcpServers && typeof mcpJsonConfig.mcpServers === 'object' ? mcpJsonConfig.mcpServers : {};

  const disabled = readMergedDisabledMcpServers(workspacePath, userHome);
  const sources = [
    { servers: mcpJsonServers, origin: 'project', source: displayPath(path.join(workspacePath, '.mcp.json'), userHome) },
    { servers: projectScopedServers, origin: 'project', source: displayPath(path.join(userHome, '.claude.json'), userHome) },
    { servers: userServers, origin: 'user', source: displayPath(path.join(userHome, '.claude.json'), userHome) },
  ];

  const byName = new Map();
  for (const { servers, origin, source } of sources) {
    for (const [name, config] of Object.entries(servers)) {
      if (byName.has(name)) continue;
      byName.set(name, {
        id: name,
        name,
        description: describeServer(config),
        origin,
        source,
        enabled: !disabled.has(name),
        toggleable: true,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function toggleClaudeMcp(workspacePath, userHome, name, enabled) {
  const settingsPath = claudeSettingsLocalPath(workspacePath);
  const settings = readJsonSafe(settingsPath);
  const current = Array.isArray(settings.disabledMcpServers) ? settings.disabledMcpServers : [];
  const withoutName = current.filter((entry) => entry !== name);
  settings.disabledMcpServers = enabled ? withoutName : [...withoutName, name];
  writeJsonPretty(settingsPath, settings);
  return listClaudeMcp(workspacePath, userHome).find((item) => item.id === name)
    ?? { id: name, name, origin: 'project', source: displayPath(settingsPath, userHome), enabled, toggleable: true };
}

module.exports = {
  listClaudeMcp,
  toggleClaudeMcp,
  claudeSettingsLocalPath,
  readJsonSafe,
  writeJsonPretty,
};
