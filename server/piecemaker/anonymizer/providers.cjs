/**
 * Branchement des clients IA sur le proxy d'anonymisation.
 *
 * Le serveur pose `HTTPS_PROXY` et le certificat de l'autorité locale.
 * Les URL des fournisseurs ne sont pas réécrites.
 *
 * Cursor ignore tout proxy HTTP. Tant qu'un mapping existe, un shim en tête
 * de `PATH` refuse de lancer `cursor-agent`.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  configureClaudeCodeProxy,
  bypassClaudeCodeProxy,
  configureCodexProxy,
  bypassCodexProxy,
} = require('./client-config.cjs');

function configureOpencode() {
  return { configured: true, changed: false, conflict: false, file: null };
}

function bypassOpencode() {
  return { bypassed: true, changed: false, conflict: false, file: null };
}

/** Première ligne du garde-fou Cursor : ce que le shim écrit avant de renoncer. */
const CURSOR_REFUSAL = 'PieceMaker : cursor-agent ne peut pas être filtré par le proxy d’anonymisation '
  + '(son protocole n’accepte aucune base d’URL). Tant qu’un mapping existe, il est bloqué pour éviter '
  + 'que des noms de parties quittent la machine en clair. Utilisez Claude, Codex ou opencode.';

/**
 * Écrit le shim `cursor-agent` dans un répertoire que le service place en tête
 * de `PATH`. Le shim ne lit jamais le contenu du mapping — sa seule existence
 * décide —, et se retire du `PATH` avant de relayer le vrai binaire pour ne pas
 * se rappeler lui-même.
 */
function installCursorGuard({ binDir, mappingFile }) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'cursor-agent');
  const script = `#!/bin/sh
# Généré par PieceMaker — ne pas modifier. Voir server/piecemaker/anonymizer/providers.cjs
if [ -s ${JSON.stringify(mappingFile)} ]; then
  printf '%s\\n' ${JSON.stringify(CURSOR_REFUSAL)} >&2
  exit 78
fi
PATH=$(printf '%s' "$PATH" | sed -e "s|^${binDir.replace(/[|\\]/g, '\\$&')}:||")
export PATH
exec cursor-agent "$@"
`;
  fs.writeFileSync(file, script, { encoding: 'utf8', mode: 0o755 });
  return { file, binDir };
}

/**
 * Câble tous les fournisseurs sur `origin` et rend un rapport par client.
 * Aucun échec n'est fatal : un client mal configuré est signalé « non couvert »
 * dans le statut, ce qui est l'information utile, plutôt que d'empêcher le
 * serveur de démarrer.
 */
async function configureProviders({ origin, caFile, userHome = os.homedir(), binDir, mappingFile }) {
  const report = {};

  const attempt = (name, run) => {
    try {
      report[name] = run();
    } catch (error) {
      report[name] = { configured: false, changed: false, conflict: true, reason: error.message };
    }
  };

  attempt('claude', () => configureClaudeCodeProxy({ proxyUrl: origin, caFile, userHome }));
  attempt('codex', () => configureCodexProxy({
    codexHome: process.env.CODEX_HOME || path.join(userHome, '.codex'),
  }));
  attempt('opencode', () => configureOpencode());
  attempt('cursor', () => ({
    configured: false,
    changed: false,
    conflict: false,
    blocked: true,
    reason: 'not-interceptable',
    ...installCursorGuard({ binDir, mappingFile }),
  }));

  return report;
}

/** Défait tout ce que `configureProviders` a posé : l'arrêt du serveur ne doit pas laisser de base morte. */
async function bypassProviders({ userHome = os.homedir(), binDir }) {
  const report = {};
  const attempt = (name, run) => {
    try {
      report[name] = run();
    } catch (error) {
      report[name] = { bypassed: false, conflict: true, reason: error.message };
    }
  };

  attempt('claude', () => bypassClaudeCodeProxy({ userHome }));
  attempt('codex', () => bypassCodexProxy());
  attempt('opencode', () => bypassOpencode());
  attempt('cursor', () => {
    const file = path.join(binDir, 'cursor-agent');
    if (fs.existsSync(file)) fs.rmSync(file);
    return { bypassed: true, file };
  });
  return report;
}

module.exports = {
  CURSOR_REFUSAL,
  bypassOpencode,
  bypassProviders,
  configureOpencode,
  configureProviders,
  installCursorGuard,
};
