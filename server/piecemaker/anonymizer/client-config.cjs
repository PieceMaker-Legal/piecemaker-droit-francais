/**
 * Écriture atomique des configurations Claude Code et Codex pour les faire
 * passer par le proxy hudsucker de ce dépôt.
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

const PROXY_ENV = {
  HTTPS_PROXY: (proxyUrl) => proxyUrl,
  HTTP_PROXY: (proxyUrl) => proxyUrl,
  ALL_PROXY: (proxyUrl) => proxyUrl,
  NO_PROXY: () => 'localhost,127.0.0.1,::1',
  NODE_USE_ENV_PROXY: () => '1',
  NODE_EXTRA_CA_CERTS: (_proxyUrl, caFile) => caFile,
  SSL_CERT_FILE: (_proxyUrl, caFile) => caFile,
  CODEX_CA_CERTIFICATE: (_proxyUrl, caFile) => caFile,
  REQUESTS_CA_BUNDLE: (_proxyUrl, caFile) => caFile,
};

function isLoopbackProxy(value) {
  try {
    const url = new URL(String(value || ''));
    return ['127.0.0.1', 'localhost'].includes(url.hostname);
  } catch {
    return false;
  }
}

function configureClaudeCodeProxy({ proxyUrl, caFile, userHome = os.homedir() } = {}) {
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
  const existingProxy = settings.env.HTTPS_PROXY;
  if (existingProxy && existingProxy !== proxyUrl && !isLoopbackProxy(existingProxy)) {
    return { configured: false, changed: false, conflict: true, file: settingsFile, reason: 'proxy-conflict' };
  }
  const existingBase = settings.env.ANTHROPIC_BASE_URL;
  if (existingBase && !isOwnLoopbackUrl(existingBase, '/anthropic')) {
    return { configured: false, changed: false, conflict: true, file: settingsFile, reason: 'base-url-conflict' };
  }

  let changed = false;
  if (existingBase) {
    delete settings.env.ANTHROPIC_BASE_URL;
    changed = true;
  }
  for (const [key, produce] of Object.entries(PROXY_ENV)) {
    const value = produce(proxyUrl, caFile);
    if (!value) continue;
    if (settings.env[key] !== value) {
      settings.env[key] = value;
      changed = true;
    }
  }
  if (!changed) return { configured: true, changed: false, conflict: false, file: settingsFile };
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
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    if (env === undefined) return { bypassed: true, changed: false, conflict: false, file: settingsFile };
    return { bypassed: false, changed: false, conflict: true, file: settingsFile, reason: 'env-invalid' };
  }
  const ownsProxy = isLoopbackProxy(env.HTTPS_PROXY) || isOwnLoopbackUrl(env.ANTHROPIC_BASE_URL, '/anthropic');
  if (!ownsProxy) return { bypassed: true, changed: false, conflict: false, file: settingsFile };

  let changed = false;
  if (isOwnLoopbackUrl(env.ANTHROPIC_BASE_URL, '/anthropic')) {
    delete env.ANTHROPIC_BASE_URL;
    changed = true;
  }
  if (isLoopbackProxy(env.HTTPS_PROXY)) {
    for (const key of Object.keys(PROXY_ENV)) {
      if (env[key] !== undefined) {
        delete env[key];
        changed = true;
      }
    }
  }
  if (!changed) return { bypassed: true, changed: false, conflict: false, file: settingsFile };
  if (Object.keys(env).length === 0) delete settings.env;
  atomicWrite(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  return { bypassed: true, changed: true, conflict: false, file: settingsFile };
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

function configureCodexProxy(options = {}) {
  const removed = bypassCodexProxy(options);
  if (removed.conflict) {
    return { configured: false, changed: false, conflict: true, file: removed.file, reason: removed.reason };
  }
  return { configured: true, changed: removed.changed, conflict: false, file: removed.file };
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
  let managedEnd = lines.findIndex((line) => line.trim() === CODEX_BLOCK_END);
  if (managedStart >= 0 && managedEnd < managedStart) {
    let end = managedStart;
    for (let index = managedStart + 1; index < lines.length; index += 1) {
      if (/^\s*\[/.test(lines[index]) && !lines[index].includes('piecemaker_proxy')) break;
      end = index;
    }
    managedEnd = end;
  }
  if (managedStart < 0 && managedEnd >= 0) {
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
