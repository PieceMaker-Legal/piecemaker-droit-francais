'use strict';

/**
 * Plugins de marketplace installés pour Claude Code. L'état activé/désactivé
 * fusionne le réglage global (`~/.claude/settings.json`) et le réglage local
 * au dossier (`<dossier>/.claude/settings.local.json`, qui l'emporte), la
 * bascule n'écrivant jamais que ce second fichier.
 */
const path = require('node:path');

const { displayPath } = require('./paths.cjs');
const { readJsonSafe, writeJsonPretty, claudeSettingsLocalPath } = require('./claude-mcp.cjs');

function readPluginManifest(installPath) {
  const manifest = readJsonSafe(path.join(installPath, '.claude-plugin', 'plugin.json'));
  return {
    displayName: typeof manifest.displayName === 'string' && manifest.displayName.trim() ? manifest.displayName : undefined,
    name: typeof manifest.displayName === 'string' && manifest.displayName.trim()
      ? manifest.displayName
      : typeof manifest.name === 'string' ? manifest.name : undefined,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
  };
}

function pluginMcpServers(installPath) {
  const manifest = readJsonSafe(path.join(installPath, '.mcp.json'));
  return manifest.mcpServers && typeof manifest.mcpServers === 'object'
    ? Object.keys(manifest.mcpServers)
    : [];
}

function connectorName(plugin) {
  if (plugin.displayName) return plugin.displayName;
  if (plugin.mcpServers.length !== 1) return plugin.name;
  if (plugin.mcpServers[0].toLowerCase() === 'legifrance') return 'MCP Légifrance';
  return plugin.mcpServers[0].split(/[-_]/).filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`).join(' ');
}

function listClaudePlugins(workspacePath, userHome) {
  const installed = readJsonSafe(path.join(userHome, '.claude', 'plugins', 'installed_plugins.json'));
  const plugins = installed.plugins && typeof installed.plugins === 'object' ? installed.plugins : {};
  const globalEnabled = readJsonSafe(path.join(userHome, '.claude', 'settings.json')).enabledPlugins || {};
  const projectEnabled = readJsonSafe(claudeSettingsLocalPath(workspacePath)).enabledPlugins || {};

  return Object.keys(plugins)
    .sort((a, b) => a.localeCompare(b))
    .map((pluginId) => {
      const installs = Array.isArray(plugins[pluginId]) ? plugins[pluginId] : [];
      const install = installs[0] || {};
      const manifest = install.installPath ? readPluginManifest(install.installPath) : {};
      const enabled = projectEnabled[pluginId] ?? globalEnabled[pluginId] ?? true;
      return {
        id: pluginId,
        name: manifest.name || pluginId,
        displayName: manifest.displayName,
        description: manifest.description,
        origin: 'plugin',
        source: install.installPath ? displayPath(install.installPath, userHome) : pluginId,
        enabled: Boolean(enabled),
        toggleable: true,
        mcpServers: install.installPath ? pluginMcpServers(install.installPath) : [],
      };
    });
}

function listClaudePluginConnectors(workspacePath, userHome) {
  return listClaudePlugins(workspacePath, userHome)
    .filter((plugin) => plugin.mcpServers.length > 0)
    .map((plugin) => ({
      id: plugin.id,
      name: connectorName(plugin),
      description: plugin.description || plugin.mcpServers.join(', '),
      origin: 'plugin',
      source: plugin.source,
      enabled: plugin.enabled,
      toggleable: plugin.toggleable,
      family: 'plugin',
      protocol: 'MCP',
    }));
}

function toggleClaudePlugin(workspacePath, userHome, id, enabled) {
  const settingsPath = claudeSettingsLocalPath(workspacePath);
  const settings = readJsonSafe(settingsPath);
  const enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === 'object' ? { ...settings.enabledPlugins } : {};
  enabledPlugins[id] = enabled;
  settings.enabledPlugins = enabledPlugins;
  writeJsonPretty(settingsPath, settings);
  return listClaudePlugins(workspacePath, userHome).find((item) => item.id === id)
    ?? { id, name: id, origin: 'plugin', source: id, enabled, toggleable: true };
}

module.exports = { listClaudePlugins, listClaudePluginConnectors, toggleClaudePlugin };
