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
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSqliteDictionaryLoader } = require('./sqlite-dictionary.cjs');
const { startRewriterBridge } = require('./rewriter-bridge.cjs');
const { bypassProviders, configureProviders } = require('./providers.cjs');
const { createHarnessJuridique } = require('../harness/index.cjs');

const ENV_VAR = 'ANTHROPIC_BASE_URL';
const OPENAI_ENV_VAR = 'OPENAI_BASE_URL';
const DEFAULT_UPSTREAM = 'https://api.anthropic.com';
const DEFAULT_PORT = 4111;
const PROXY_ENV_KEYS = [
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'CODEX_CA_CERTIFICATE', 'REQUESTS_CA_BUNDLE',
];

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

function hudsuckerBinary() {
  if (process.env.PIECEMAKER_HUDSUCKER_BIN) return process.env.PIECEMAKER_HUDSUCKER_BIN;
  const name = process.platform === 'win32' ? 'piecemaker-hudsucker.exe' : 'piecemaker-hudsucker';
  const packaged = path.join(__dirname, 'bin', name);
  const release = path.join(__dirname, 'hudsucker-proxy', 'target', 'release', name);
  const debug = path.join(__dirname, 'hudsucker-proxy', 'target', 'debug', name);
  if (fs.existsSync(packaged)) return packaged;
  if (fs.existsSync(release)) return release;
  if (fs.existsSync(debug)) return debug;
  return packaged;
}

function certificatePaths() {
  const directory = path.join(os.homedir(), '.piecemaker', 'certs');
  return {
    cert: path.join(directory, 'piecemaker-ca.crt'),
    key: path.join(directory, 'piecemaker-ca.key'),
  };
}

function waitForOutput(child, needle, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const finish = (failed, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off('data', take);
      child.stderr?.off('data', take);
      child.off('exit', onExit);
      if (failed) reject(value);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(true, new Error(`hudsucker n'a pas écouté : ${buffer}`)), timeoutMs);
    const take = (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes(needle)) finish(false, buffer);
    };
    const onExit = (code) => finish(true, new Error(`hudsucker sorti (${code}) : ${buffer}`));
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.once('exit', onExit);
  });
}

function proxyEnvironment(proxyUrl, caFile) {
  return {
    HTTPS_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    NODE_USE_ENV_PROXY: '1',
    NODE_EXTRA_CA_CERTS: caFile,
    SSL_CERT_FILE: caFile,
    CODEX_CA_CERTIFICATE: caFile,
    REQUESTS_CA_BUNDLE: caFile,
  };
}

function createAnonymizerService({ homeDir, userHome = os.homedir(), logger = console, required = false }) {
  const dictionary = createSqliteDictionaryLoader({ databasePath: process.env.DATABASE_PATH || path.join(homeDir, 'auth.db') });
  const legacyMappingFile = path.join(homeDir, 'central-mapping.json');
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
  let bridge = null;
  let previousEnv = null;

  async function start() {
    if (proxy) return state;
    if (!required && isDisabled(homeDir)) {
      state.reason = 'disabled';
      return state;
    }

    const binary = hudsuckerBinary();
    const certificates = certificatePaths();
    if (!fs.existsSync(binary) || !fs.existsSync(certificates.cert) || !fs.existsSync(certificates.key)) {
      state.reason = 'binary_or_ca_missing';
      logger.warn?.('[piecemaker] hudsucker ou autorité locale absent');
      return state;
    }

    const claudeUpstream = resolveUpstream(process.env[ENV_VAR]);
    const hosts = ['api.anthropic.com', 'api.openai.com', 'chatgpt.com'];
    try {
      const extra = new URL(claudeUpstream).hostname;
      if (extra && !hosts.includes(extra)) hosts.push(extra);
    } catch {
      // l'amont par défaut reste la liste fixe
    }

    try {
      bridge = await startRewriterBridge({ dictionary, harness });
    } catch (error) {
      state.reason = `listen_failed: ${error.message}`;
      logger.warn?.(`[piecemaker] réécriture PII non démarrée : ${error.message}`);
      return state;
    }

    const listenedPort = DEFAULT_PORT;
    const origin = `http://127.0.0.1:${listenedPort}`;
    const child = spawn(binary, [
      '--listen', `127.0.0.1:${listenedPort}`,
      '--rewriter', `http://127.0.0.1:${bridge.port}`,
      '--ca-cert', certificates.cert,
      '--ca-key', certificates.key,
      '--hosts', hosts.join(','),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HTTPS_PROXY: '',
        HTTP_PROXY: '',
        ALL_PROXY: '',
        https_proxy: '',
        http_proxy: '',
        all_proxy: '',
      },
    });
    proxy = child;
    child.stdout?.on('data', (chunk) => logger.log?.(String(chunk).trim()));
    child.stderr?.on('data', (chunk) => logger.warn?.(`[piecemaker] hudsucker : ${String(chunk).trim()}`));
    try {
      await waitForOutput(child, `listening 127.0.0.1:${listenedPort}`, 15000);
    } catch (error) {
      child.kill('SIGKILL');
      proxy = null;
      await bridge.close();
      bridge = null;
      state.reason = `listen_failed: ${error.message}`;
      logger.warn?.(`[piecemaker] proxy PII non démarré : ${error.message}`);
      return state;
    }

    // Publie le port dans la config partagée pour que les consommateurs
    // indépendants du process serveur puissent le retrouver.
    try {
      const configFile = path.join(homeDir, 'config.json');
      const current = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (current.mikePiiPort !== listenedPort) {
        fs.writeFileSync(configFile, `${JSON.stringify({ ...current, mikePiiPort: listenedPort }, null, 2)}\n`, 'utf8');
      }
    } catch (error) {
      logger.warn?.(`[piecemaker] impossible de publier mikePiiPort dans config.json : ${error.message}`);
    }

    previousEnv = {
      [ENV_VAR]: process.env[ENV_VAR],
      [OPENAI_ENV_VAR]: process.env[OPENAI_ENV_VAR],
      PATH: process.env.PATH,
    };
    for (const key of PROXY_ENV_KEYS) previousEnv[key] = process.env[key];
    Object.assign(process.env, proxyEnvironment(origin, certificates.cert));
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;

    const report = await configureProviders({
      origin,
      caFile: certificates.cert,
      userHome,
      binDir,
      mappingFile: legacyMappingFile,
    });
    Object.assign(state, {
      enabled: true,
      reason: 'running',
      origin,
      upstream: claudeUpstream,
      startedAt: new Date().toISOString(),
      routes: hosts.map((host) => ({ provider: host, upstream: `https://${host}` })),
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
    if (!proxy && !bridge) {
      dictionary.close();
      return;
    }
    if (proxy && proxy.exitCode === null) {
      proxy.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => proxy.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (proxy.exitCode === null) proxy.kill('SIGKILL');
    }
    if (bridge) await bridge.close();
    bridge = null;
    await bypassProviders({ userHome, binDir });
    if (previousEnv) {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      previousEnv = null;
    }
    proxy = null;
    dictionary.close();
    Object.assign(state, { enabled: false, reason: 'stopped', origin: null, routes: [], coverage: {} });
  }

  function status() {
    const current = dictionary.get();
    return {
      ...state,
      listening: Boolean(proxy && proxy.exitCode === null && !proxy.killed),
      dictionary: {
        file: dictionary.file,
        exists: dictionary.exists(),
        entityCount: current.entityCount,
        codeCount: current.codeCount,
        updatedAt: current.updatedAt,
        empty: current.empty,
      },
      stats: bridge ? { ...bridge.stats } : null,
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
