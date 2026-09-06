/**
 * Cycle de vie du proxy PII et point d'injection dans CloudCLI.
 *
 * Deux leviers, aucun ne touchant un fichier upstream.
 *
 * **L'environnement du serveur.** Les quatre chemins de lancement de CloudCLI —
 * chat Claude, Codex, Cursor, opencode — étalent `process.env` dans le
 * sous-processus qu'ils créent, tout comme le terminal intégré. Poser des
 * variables ici les atteint donc tous les cinq sans ajouter une ligne ailleurs.
 *
 * **Les configurations utilisateur des clients.** Codex ne lit pas de variable
 * de base d'URL, opencode préfère sa configuration ; `providers.cjs` s'en
 * charge, et pose le garde-fou de Cursor, seul client non interceptable.
 *
 * Le proxy vit et meurt avec le serveur : à l'arrêt, les bases écrites sont
 * retirées pour ne pas laisser les clients pointer un port fermé.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDictionaryLoader } = require('./dictionary.cjs');
const { DEFAULT_UPSTREAM, createAnonymizerProxy } = require('./proxy.cjs');
const { bypassProviders, configureProviders } = require('./providers.cjs');
const { createHarnessJuridique } = require('../harness/index.cjs');

const ENV_VAR = 'ANTHROPIC_BASE_URL';
const OPENAI_ENV_VAR = 'OPENAI_BASE_URL';

/** Interrupteur : `PIECEMAKER_ANONYMIZER=off`, ou `anonymizer.enabled: false` dans `config.json`. */
function isDisabled(homeDir) {
  const flag = String(process.env.PIECEMAKER_ANONYMIZER || '').toLowerCase();
  if (flag === 'off' || flag === '0' || flag === 'false') return true;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(homeDir, 'config.json'), 'utf8'));
    return config?.anonymizer?.enabled === false;
  } catch {
    return false;
  }
}

/**
 * Cible du relais Anthropic. Une base distante déjà configurée (passerelle
 * d'entreprise, point de terminaison alternatif) est respectée : on se chaîne
 * derrière elle. Une base en boucle locale ne peut être qu'une instance
 * précédente de ce proxy, et serait un relais mort : on l'ignore au profit de
 * l'API officielle.
 */
function resolveUpstream(configured) {
  if (!configured) return DEFAULT_UPSTREAM;
  try {
    const { hostname } = new URL(configured);
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return DEFAULT_UPSTREAM;
    return configured;
  } catch {
    return DEFAULT_UPSTREAM;
  }
}

/**
 * Lecture du rapport de `configureProviders` en une couverture par client, la
 * seule chose que l'interface a besoin de montrer.
 *
 * `filtered` : les échanges passent par le proxy et sont anonymisés.
 * `blocked`  : le client ne peut pas être filtré et est donc empêché de partir.
 * `unconfigured` : le câblage a échoué ou est en conflit — le client peut
 * encore parler en direct, et c'est précisément ce que le statut doit crier.
 */
function summarizeCoverage(report) {
  const coverage = {};
  for (const [name, result] of Object.entries(report || {})) {
    if (result?.blocked) coverage[name] = { state: 'blocked', detail: result.reason, file: result.file || null };
    else if (result?.configured) coverage[name] = { state: 'filtered', detail: null, file: result.file || null };
    else coverage[name] = { state: 'unconfigured', detail: result?.reason || 'unknown', file: result?.file || null };
  }
  return coverage;
}

function createAnonymizerService({ homeDir, userHome = os.homedir(), logger = console, required = false }) {
  const dictionary = createDictionaryLoader({ homeDir });
  // Harnais de citations vérifiées (décisions Légifrance + bloc <CITATIONS>) :
  // son propre interrupteur (`PIECEMAKER_CITATIONS=off`) est géré à
  // l'intérieur, pas ici.
  const harness = createHarnessJuridique({ homeDir, verifyResponses: false });
  // Le shim Cursor vit sous le répertoire de données PieceMaker : il n'a rien à
  // faire dans un répertoire appartenant à un fournisseur.
  const binDir = path.join(homeDir, 'bin');
  const state = {
    enabled: false,
    reason: 'not_started',
    origin: null,
    upstream: null,
    startedAt: null,
    routes: [],
    coverage: {},
  };
  let proxy = null;
  let previousEnv = null;

  async function start() {
    if (proxy) return state;
    if (!required && isDisabled(homeDir)) {
      state.reason = 'disabled';
      return state;
    }

    const claudeUpstream = resolveUpstream(process.env[ENV_VAR]);
    proxy = createAnonymizerProxy({
      dictionary,
      routes: [
        { provider: 'claude', prefix: '/anthropic', upstream: claudeUpstream },
        { provider: 'codex', prefix: '/chatgpt', upstream: 'https://chatgpt.com/backend-api/codex' },
        { provider: 'opencode', prefix: '/openai', upstream: 'https://api.openai.com' },
      ],
      harness,
      onError: (error) => logger.warn?.(`[piecemaker] proxy PII : ${error.message}`),
    });

    let origin;
    try {
      ({ origin } = await proxy.listen());
    } catch (error) {
      proxy = null;
      state.reason = `listen_failed: ${error.message}`;
      logger.warn?.(`[piecemaker] proxy PII non démarré : ${error.message}`);
      return state;
    }

    previousEnv = {
      [ENV_VAR]: process.env[ENV_VAR],
      [OPENAI_ENV_VAR]: process.env[OPENAI_ENV_VAR],
      PATH: process.env.PATH,
    };
    process.env[ENV_VAR] = `${origin}/anthropic`;
    process.env[OPENAI_ENV_VAR] = `${origin}/openai`;
    // En tête de chemin : le shim doit être trouvé avant le vrai `cursor-agent`.
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;

    const report = await configureProviders({ origin, userHome, binDir, mappingFile: dictionary.file });
    Object.assign(state, {
      enabled: true,
      reason: 'running',
      origin,
      upstream: claudeUpstream,
      startedAt: new Date().toISOString(),
      routes: proxy.routes,
      coverage: summarizeCoverage(report),
    });

    const uncovered = Object.entries(state.coverage)
      .filter(([, value]) => value.state === 'unconfigured')
      .map(([name]) => name);
    logger.log?.(`[piecemaker] anonymisation active sur ${origin} (claude, codex, opencode ; cursor bloqué)`);
    if (uncovered.length) {
      logger.warn?.(`[piecemaker] clients non filtrés, à vérifier : ${uncovered.join(', ')}`);
    }
    return state;
  }

  async function stop() {
    if (!proxy) return;
    await proxy.close();
    await bypassProviders({ userHome, binDir });
    if (previousEnv) {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      previousEnv = null;
    }
    proxy = null;
    Object.assign(state, { enabled: false, reason: 'stopped', origin: null, routes: [], coverage: {} });
  }

  function status() {
    const current = dictionary.get();
    return {
      ...state,
      listening: Boolean(proxy?.listening),
      dictionary: {
        file: dictionary.file,
        exists: dictionary.exists(),
        entityCount: current.entityCount,
        codeCount: current.codeCount,
        updatedAt: current.updatedAt,
        empty: current.empty,
      },
      stats: proxy ? { ...proxy.stats } : null,
    };
  }

  return { dictionary, start, status, stop };
}

module.exports = {
  ENV_VAR,
  OPENAI_ENV_VAR,
  createAnonymizerService,
  isDisabled,
  resolveUpstream,
  summarizeCoverage,
};
