/**
 * Écriture atomique des configurations Claude Code et Codex pour les faire
 * passer par le proxy PII de ce dépôt (`./proxy.cjs`).
 *
 * Propre à ce fichier, sans dépendance vendor : l'identifiant de bloc
 * `piecemaker_proxy` et les marqueurs qui l'entourent n'appartiennent qu'à
 * ce proxy. Le fournisseur Codex géré n'a jamais parlé que HTTP Responses.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CODEX_PROVIDER_ID = 'piecemaker_proxy';
const CODEX_BLOCK_START = '# >>> PieceMaker Proxy PII (géré automatiquement)';
const CODEX_BLOCK_END = '# <<< PieceMaker Proxy PII';

function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.piecemaker-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode });
  fs.renameSync(temporary, file);
}

/** Une base que PieceMaker a écrite — donc que PieceMaker peut réécrire ou retirer. */
function isOwnLoopbackUrl(value, suffix) {
  try {
    const url = new URL(String(value || ''));
    return ['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.pathname.replace(/\/$/, '') === suffix;
  } catch {
    return false;
  }
}

function configureClaudeCodeProxy({ baseUrl, userHome = os.homedir() } = {}) {
  const settingsFile = path.join(userHome, '.claude', 'settings.json');
  let settings = {};
  try {
    if (fs.existsSync(settingsFile)) {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('objet JSON attendu');
      settings = parsed;
    }
  } catch {
    return { configured: false, changed: false, conflict: true, file: settingsFile, reason: 'settings-invalid' };
  }

  if (settings.env !== undefined
    && (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env))) {
    return { configured: false, changed: false, conflict: true, file: settingsFile, reason: 'env-invalid' };
  }
  if (!settings.env) settings.env = {};
  const existing = settings.env.ANTHROPIC_BASE_URL;
  if (existing && existing !== baseUrl && !isOwnLoopbackUrl(existing, '/anthropic')) {
    return { configured: false, changed: false, conflict: true, file: settingsFile, reason: 'base-url-conflict' };
  }
  if (existing === baseUrl) return { configured: true, changed: false, conflict: false, file: settingsFile };

  settings.env.ANTHROPIC_BASE_URL = baseUrl;
  atomicWrite(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  return { configured: true, changed: true, conflict: false, file: settingsFile };
}

function bypassClaudeCodeProxy({ userHome = os.homedir() } = {}) {
  const settingsFile = path.join(userHome, '.claude', 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    return { bypassed: true, changed: false, conflict: false, file: settingsFile };
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('objet JSON attendu');
  } catch {
    return { bypassed: false, changed: false, conflict: true, file: settingsFile, reason: 'settings-invalid' };
  }

  const env = settings.env;
  if (env === undefined || (env && typeof env === 'object' && !Array.isArray(env)
      && !env.ANTHROPIC_BASE_URL)) {
    return { bypassed: true, changed: false, conflict: false, file: settingsFile };
  }
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return { bypassed: false, changed: false, conflict: true, file: settingsFile, reason: 'env-invalid' };
  }
  if (!isOwnLoopbackUrl(env.ANTHROPIC_BASE_URL, '/anthropic')) {
    return { bypassed: true, changed: false, conflict: false, file: settingsFile };
  }

  delete env.ANTHROPIC_BASE_URL;
  if (Object.keys(env).length === 0) delete settings.env;
  atomicWrite(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  return { bypassed: true, changed: true, conflict: false, file: settingsFile };
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function topLevelAssignment(lines, key) {
  const expression = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*?)\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*\[/.test(line)) break;
    const match = line.match(expression);
    if (match) return { index, raw: match[1] };
  }
  return null;
}

function parseTomlString(raw) {
  const value = String(raw || '').trim();
  if (value.startsWith('"')) {
    const literal = value.match(/^("(?:\\.|[^"\\])*")/)?.[1];
    try { return literal ? JSON.parse(literal) : null; } catch { return null; }
  }
  const literal = value.match(/^'([^']*)'/)?.[1];
  if (literal !== undefined) return literal;
  return null;
}

function configureCodexProxy({
  baseUrl,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
} = {}) {
  const configFile = path.join(codexHome, 'config.toml');
  let content = '';
  try { content = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : ''; } catch {
    return { configured: false, changed: false, conflict: true, file: configFile, reason: 'config-unreadable' };
  }

  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  const provider = topLevelAssignment(lines, 'model_provider');
  const providerValue = provider ? parseTomlString(provider.raw) : 'openai';
  if (provider && !['openai', CODEX_PROVIDER_ID].includes(providerValue)) {
    return { configured: false, changed: false, conflict: true, file: configFile, reason: 'provider-conflict' };
  }

  const managedTable = lines.findIndex((line) => line.trim() === `[model_providers.${CODEX_PROVIDER_ID}]`);
  const managedStart = lines.findIndex((line) => line.trim() === CODEX_BLOCK_START);
  const managedEnd = lines.findIndex((line) => line.trim() === CODEX_BLOCK_END);
  if (managedTable >= 0 && (managedStart < 0 || managedEnd < managedTable)) {
    return { configured: false, changed: false, conflict: true, file: configFile, reason: 'provider-table-conflict' };
  }

  if (provider) {
    lines[provider.index] = `model_provider = ${tomlString(CODEX_PROVIDER_ID)} # géré par PieceMaker`;
  } else {
    const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
    lines.splice(firstTable < 0 ? 0 : firstTable, 0,
      '# Fournisseur Responses protégé par PieceMaker.',
      `model_provider = ${tomlString(CODEX_PROVIDER_ID)} # géré par PieceMaker`,
      '');
  }

  // Le proxy de ce dépôt parle HTTP Responses, jamais WebSocket.
  const block = [
    CODEX_BLOCK_START,
    `[model_providers.${CODEX_PROVIDER_ID}]`,
    'name = "PieceMaker · Proxy PII"',
    `base_url = ${tomlString(baseUrl)}`,
    'requires_openai_auth = true',
    'wire_api = "responses"',
    'supports_websockets = false',
    CODEX_BLOCK_END,
  ];
  if (managedStart >= 0 && managedEnd >= managedStart) {
    lines.splice(managedStart, managedEnd - managedStart + 1, ...block);
  } else {
    while (lines.at(-1) === '') lines.pop();
    lines.push('', ...block);
  }
  const normalized = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  if (normalized === `${content.replace(/^﻿/, '').replace(/\n*$/, '')}\n`) {
    return { configured: true, changed: false, conflict: false, file: configFile };
  }
  atomicWrite(configFile, normalized);
  return { configured: true, changed: true, conflict: false, file: configFile };
}

function bypassCodexProxy({
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
} = {}) {
  const configFile = path.join(codexHome, 'config.toml');
  if (!fs.existsSync(configFile)) {
    return { bypassed: true, changed: false, conflict: false, file: configFile };
  }

  let content;
  try { content = fs.readFileSync(configFile, 'utf8'); } catch {
    return { bypassed: false, changed: false, conflict: true, file: configFile, reason: 'config-unreadable' };
  }

  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  const provider = topLevelAssignment(lines, 'model_provider');
  const providerValue = provider ? parseTomlString(provider.raw) : 'openai';
  const managedStart = lines.findIndex((line) => line.trim() === CODEX_BLOCK_START);
  const managedEnd = lines.findIndex((line) => line.trim() === CODEX_BLOCK_END);
  if ((managedStart < 0) !== (managedEnd < 0) || managedEnd < managedStart) {
    return { bypassed: false, changed: false, conflict: true, file: configFile, reason: 'provider-block-invalid' };
  }
  if (providerValue !== CODEX_PROVIDER_ID && managedStart < 0) {
    return { bypassed: true, changed: false, conflict: false, file: configFile };
  }
  if (managedStart >= 0) lines.splice(managedStart, managedEnd - managedStart + 1);

  if (providerValue === CODEX_PROVIDER_ID) {
    lines[provider.index] = 'model_provider = "openai"';
    if (lines[provider.index - 1]?.trim() === '# Fournisseur Responses protégé par PieceMaker.') {
      lines.splice(provider.index - 1, 1);
    }
  }

  const normalized = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  if (normalized === `${content.replace(/^﻿/, '').replace(/\n*$/, '')}\n`) {
    return { bypassed: true, changed: false, conflict: false, file: configFile };
  }
  atomicWrite(configFile, normalized);
  return { bypassed: true, changed: true, conflict: false, file: configFile };
}

module.exports = {
  CODEX_PROVIDER_ID,
  configureClaudeCodeProxy,
  bypassClaudeCodeProxy,
  configureCodexProxy,
  bypassCodexProxy,
};
