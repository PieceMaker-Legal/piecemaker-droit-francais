const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function bundledClaudeExecutable(appData, fileSystem = fs) {
  if (!appData) return null;
  const root = path.win32.join(appData, 'Claude', 'claude-code');
  let versions;
  try {
    versions = fileSystem.readdirSync(root).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  } catch {
    return null;
  }
  for (const version of versions) {
    let builds;
    try { builds = fileSystem.readdirSync(path.win32.join(root, version)); } catch { continue; }
    for (const build of builds) {
      const candidate = path.win32.join(root, version, build, 'claude.exe');
      if (fileSystem.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function claudeOnPath(lookup = execFileSync) {
  try {
    const candidates = String(lookup('where.exe', ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }))
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return candidates.find((entry) => /\.exe$/i.test(entry))
      || candidates.find((entry) => /\.(cmd|bat)$/i.test(entry))
      || null;
  } catch {
    return null;
  }
}

function claudeExecutable({ platform = process.platform, env = process.env, fileSystem = fs, lookup = execFileSync } = {}) {
  const configured = String(env.CLAUDE_CLI_PATH || '').replace(/^"|"$/g, '');
  if (configured) return configured;
  if (platform !== 'win32') return 'claude';
  return claudeOnPath(lookup) || bundledClaudeExecutable(env.APPDATA, fileSystem) || 'claude.cmd';
}

module.exports = { bundledClaudeExecutable, claudeExecutable };
