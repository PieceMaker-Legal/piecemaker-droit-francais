const fs = require('node:fs');
const path = require('node:path');

const LEGACY_PROXY_KEYS = [
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'CODEX_CA_CERTIFICATE', 'REQUESTS_CA_BUNDLE',
];

function readObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeObject(file, value) {
  const temporary = `${file}.piecemaker-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function isLoopback(value) {
  try {
    return ['127.0.0.1', 'localhost'].includes(new URL(String(value || '')).hostname);
  } catch {
    return false;
  }
}

function isProxyGuard(hook) {
  return [hook?.command, hook?.commandWindows].some((command) => typeof command === 'string' && command.includes('proxy-guard.mjs'));
}

function withoutProxyGuard(groups) {
  if (!Array.isArray(groups)) return groups;
  return groups
    .map((group) => (Array.isArray(group?.hooks) ? { ...group, hooks: group.hooks.filter((hook) => !isProxyGuard(hook)) } : group))
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length);
}

function cleanClaudeSettings(file) {
  const settings = readObject(file);
  if (!settings) return false;
  let changed = false;
  if (settings.env && isLoopback(settings.env.HTTPS_PROXY)) {
    for (const key of LEGACY_PROXY_KEYS) delete settings.env[key];
    if (!Object.keys(settings.env).length) delete settings.env;
    changed = true;
  }
  const current = settings.hooks?.SessionStart;
  const sessionStart = withoutProxyGuard(current);
  if (Array.isArray(current) && JSON.stringify(sessionStart) !== JSON.stringify(current)) {
    if (sessionStart.length) settings.hooks.SessionStart = sessionStart;
    else delete settings.hooks.SessionStart;
    changed = true;
  }
  if (changed) writeObject(file, settings);
  return changed;
}

function cleanCodexHooks(file) {
  const document = readObject(file);
  const current = document?.hooks?.SessionStart;
  const sessionStart = withoutProxyGuard(current);
  if (!Array.isArray(current) || JSON.stringify(sessionStart) === JSON.stringify(current)) return false;
  if (sessionStart.length) document.hooks.SessionStart = sessionStart;
  else delete document.hooks.SessionStart;
  writeObject(file, document);
  return true;
}

function cleanPieceMakerConfig(homeDir) {
  const file = path.join(homeDir, 'config.json');
  const config = readObject(file);
  let changed = false;
  if (config && 'mikePiiPort' in config) {
    delete config.mikePiiPort;
    writeObject(file, config);
    changed = true;
  }
  const statuslineCache = path.join(homeDir, 'proxy-statusline.json');
  if (fs.existsSync(statuslineCache)) {
    fs.rmSync(statuslineCache, { force: true });
    changed = true;
  }
  return changed;
}

function removeLegacyProxyConfig({ userHome, homeDir = path.join(userHome, '.piecemaker') }) {
  const cleaned = [];
  const attempt = (name, run) => {
    try {
      if (run()) cleaned.push(name);
    } catch {
      return;
    }
  };
  attempt('claude', () => cleanClaudeSettings(path.join(userHome, '.claude', 'settings.json')));
  attempt('codex', () => cleanCodexHooks(path.join(process.env.CODEX_HOME || path.join(userHome, '.codex'), 'hooks.json')));
  attempt('piecemaker', () => cleanPieceMakerConfig(homeDir));
  return cleaned;
}

module.exports = { removeLegacyProxyConfig };
