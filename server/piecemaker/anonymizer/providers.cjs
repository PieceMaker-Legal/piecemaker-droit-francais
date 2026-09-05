/**
 * Branchement des quatre clients IA de CloudCLI sur le proxy PII.
 *
 * Chaque client a son propre levier, et un seul est universel : la variable
 * d'environnement du serveur, dont héritent les quatre chemins de lancement.
 * Elle ne suffit pourtant que là où le CLI honore une base d'URL, d'où un
 * second levier — le fichier de configuration utilisateur — pour Codex et
 * opencode, et un troisième pour Cursor, qui n'en honore aucun.
 *
 *  | client   | levier                                             |
 *  |----------|----------------------------------------------------|
 *  | claude   | `ANTHROPIC_BASE_URL` + `~/.claude/settings.json`   |
 *  | codex    | `~/.codex/config.toml` (bloc géré)                  |
 *  | opencode | `provider.*.options.baseURL` de sa configuration    |
 *  | cursor   | aucun — voir plus bas                               |
 *
 * **Cursor.** `cursor-agent` parle le protocole d'authentification de Cursor et
 * ignore toute base d'URL : il n'est pas interceptable. Le laisser tourner
 * enverrait des noms de parties en clair. À défaut de pouvoir le filtrer, on
 * l'empêche de partir : un exécutable `cursor-agent` posé en tête de `PATH`
 * refuse de s'exécuter tant qu'un mapping existe, et relaie le vrai binaire
 * sinon. C'est le seul fournisseur pour lequel la garantie se paie d'un refus,
 * et cela reste préférable à une fuite silencieuse.
 *
 * La configuration Claude et Codex réutilise le code de l'installateur
 * (`vendor/installer/lib/litellm-proxy.mjs`) : écriture atomique, détection de
 * conflit et réversibilité déjà éprouvées. On conserve volontairement son
 * identifiant de bloc `piecemaker_litellm` — un poste où l'installateur est
 * passé voit ainsi son bloc *remplacé*, non doublé.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Chargement paresseux : le module de l'installateur est en ESM. */
let vendorPromise = null;
function vendor() {
  if (!vendorPromise) vendorPromise = import('../vendor/installer/lib/litellm-proxy.mjs');
  return vendorPromise;
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

function opencodeConfigFile(userHome) {
  if (process.env.OPENCODE_CONFIG) return process.env.OPENCODE_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || path.join(userHome, '.config');
  return path.join(base, 'opencode', 'opencode.json');
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.piecemaker-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * opencode lit `provider.<id>.options.baseURL`. On câble les deux familles que
 * le proxy sait router ; les autres fournisseurs éventuellement configurés
 * restent intacts, et donc hors couverture — le statut le dit.
 */
const OPENCODE_ROUTES = [
  { id: 'anthropic', suffix: '/anthropic' },
  { id: 'openai', suffix: '/openai' },
];

function configureOpencode({ origin, userHome }) {
  const file = opencodeConfigFile(userHome);
  let config = {};
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('objet JSON attendu');
      config = parsed;
    }
  } catch {
    return { configured: false, changed: false, conflict: true, file, reason: 'config-invalid' };
  }

  if (config.provider !== undefined
    && (!config.provider || typeof config.provider !== 'object' || Array.isArray(config.provider))) {
    return { configured: false, changed: false, conflict: true, file, reason: 'provider-invalid' };
  }
  if (!config.provider) config.provider = {};

  let changed = false;
  for (const { id, suffix } of OPENCODE_ROUTES) {
    const target = `${origin}${suffix}`;
    const entry = config.provider[id];
    if (entry !== undefined && (!entry || typeof entry !== 'object' || Array.isArray(entry))) {
      return { configured: false, changed: false, conflict: true, file, reason: `provider-${id}-invalid` };
    }
    const options = entry?.options;
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) {
      return { configured: false, changed: false, conflict: true, file, reason: `options-${id}-invalid` };
    }
    const existing = options?.baseURL;
    // Une base tierce délibérément posée par l'utilisateur n'est pas écrasée :
    // on signale le conflit plutôt que de casser sa configuration en silence.
    if (existing && existing !== target && !isOwnLoopbackUrl(existing, suffix)) {
      return { configured: false, changed: false, conflict: true, file, reason: `base-url-conflict:${id}` };
    }
    if (existing === target) continue;
    config.provider[id] = { ...entry, options: { ...options, baseURL: target } };
    changed = true;
  }

  if (changed) writeJsonAtomic(file, config);
  return { configured: true, changed, conflict: false, file };
}

function bypassOpencode({ userHome }) {
  const file = opencodeConfigFile(userHome);
  if (!fs.existsSync(file)) return { bypassed: true, changed: false, conflict: false, file };

  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('objet JSON attendu');
  } catch {
    return { bypassed: false, changed: false, conflict: true, file, reason: 'config-invalid' };
  }

  let changed = false;
  for (const { id, suffix } of OPENCODE_ROUTES) {
    const options = config.provider?.[id]?.options;
    if (!options || typeof options !== 'object' || Array.isArray(options)) continue;
    if (!isOwnLoopbackUrl(options.baseURL, suffix)) continue;
    delete options.baseURL;
    if (Object.keys(options).length === 0) delete config.provider[id].options;
    if (Object.keys(config.provider[id]).length === 0) delete config.provider[id];
    changed = true;
  }
  if (changed && config.provider && Object.keys(config.provider).length === 0) delete config.provider;
  if (changed) writeJsonAtomic(file, config);
  return { bypassed: true, changed, conflict: false, file };
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
async function configureProviders({ origin, userHome = os.homedir(), binDir, mappingFile }) {
  const { configureClaudeCodeProxy, configureCodexProxy } = await vendor();
  const report = {};

  const attempt = (name, run) => {
    try {
      report[name] = run();
    } catch (error) {
      report[name] = { configured: false, changed: false, conflict: true, reason: error.message };
    }
  };

  attempt('claude', () => configureClaudeCodeProxy({ baseUrl: `${origin}/anthropic`, userHome }));
  attempt('codex', () => configureCodexHttpProxy({ configureCodexProxy, origin, userHome }));
  attempt('opencode', () => configureOpencode({ origin, userHome }));
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

function configureCodexHttpProxy({ configureCodexProxy, origin, userHome }) {
  const result = configureCodexProxy({
    baseUrl: `${origin}/chatgpt`,
    codexHome: process.env.CODEX_HOME || path.join(userHome, '.codex'),
  });
  if (!result.configured) return result;
  const content = fs.readFileSync(result.file, 'utf8');
  const start = content.indexOf('# >>> PieceMaker LiteLLM (géré automatiquement)');
  const end = content.indexOf('# <<< PieceMaker LiteLLM', start);
  if (start < 0 || end < start) return { ...result, configured: false, reason: 'managed-block-missing' };
  const block = content.slice(start, end);
  if ((block.match(/^supports_websockets = true$/gm) || []).length !== 1) {
    return { ...result, configured: false, reason: 'managed-transport-conflict' };
  }
  const rewritten = content.slice(0, start) + block.replace(/^supports_websockets = true$/m, 'supports_websockets = false') + content.slice(end);
  const temporary = `${result.file}.piecemaker-http-${process.pid}`;
  fs.writeFileSync(temporary, rewritten, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, result.file);
  return { ...result, changed: true };
}

/** Défait tout ce que `configureProviders` a posé : l'arrêt du serveur ne doit pas laisser de base morte. */
async function bypassProviders({ userHome = os.homedir(), binDir }) {
  const { bypassClaudeCodeProxy, bypassCodexProxy } = await vendor();
  const report = {};
  const attempt = (name, run) => {
    try {
      report[name] = run();
    } catch (error) {
      report[name] = { bypassed: false, conflict: true, reason: error.message };
    }
  };

  attempt('claude', () => bypassClaudeCodeProxy({ userHome }));
  attempt('codex', () => bypassCodexProxy({ codexHome: process.env.CODEX_HOME || path.join(userHome, '.codex') }));
  attempt('opencode', () => bypassOpencode({ userHome }));
  attempt('cursor', () => {
    const file = path.join(binDir, 'cursor-agent');
    if (fs.existsSync(file)) fs.rmSync(file);
    return { bypassed: true, file };
  });
  return report;
}

module.exports = {
  CURSOR_REFUSAL,
  OPENCODE_ROUTES,
  bypassOpencode,
  bypassProviders,
  configureOpencode,
  configureCodexHttpProxy,
  configureProviders,
  installCursorGuard,
  isOwnLoopbackUrl,
  opencodeConfigFile,
};
