const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.piecemaker-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode });
  fs.renameSync(temporary, file);
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

  let changed = false;
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
  if (!isLoopbackProxy(env.HTTPS_PROXY)) return { bypassed: true, changed: false, conflict: false, file: settingsFile };

  let changed = false;
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

function configureCodexProxy() {
  return { configured: true, changed: false, conflict: false, file: null };
}

function bypassCodexProxy() {
  return { bypassed: true, changed: false, conflict: false, file: null };
}

module.exports = {
  configureClaudeCodeProxy,
  bypassClaudeCodeProxy,
  configureCodexProxy,
  bypassCodexProxy,
};
