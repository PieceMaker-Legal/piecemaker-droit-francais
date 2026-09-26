const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');

const { createSqliteDictionaryLoader } = require('./sqlite-dictionary.cjs');
const { startRewriterBridge } = require('./rewriter-bridge.cjs');
const { removeLegacyProxyConfig } = require('./client-config.cjs');
const { createHarnessJuridique } = require('../harness/index.cjs');

const DEFAULT_UPSTREAM = 'https://api.anthropic.com';
const INTERCEPTED_HOSTS = ['api.anthropic.com', 'api.openai.com', 'chatgpt.com'];
const COVERAGE = {
  claude: { state: 'filtered', detail: null, file: null },
  codex: { state: 'filtered', detail: null, file: null },
  opencode: { state: 'filtered', detail: null, file: null },
  cursor: { state: 'blocked', detail: 'not-interceptable', file: null },
};

const CURSOR_REFUSAL = 'PieceMaker : cursor-agent ne peut pas être filtré par le proxy d’anonymisation '
  + '(son protocole n’accepte aucune base d’URL). Tant qu’un mapping existe, il est bloqué pour éviter '
  + 'que des noms de parties quittent la machine en clair. Utilisez Claude, Codex ou opencode.';

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

function hudsuckerBinary() {
  if (process.env.PIECEMAKER_HUDSUCKER_BIN) return process.env.PIECEMAKER_HUDSUCKER_BIN;
  const name = process.platform === 'win32' ? 'piecemaker-hudsucker.exe' : 'piecemaker-hudsucker';
  const candidates = [
    path.join(__dirname, 'bin', name),
    path.join(__dirname, 'hudsucker-proxy', 'target', 'release', name),
    path.join(__dirname, 'hudsucker-proxy', 'target', 'debug', name),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function certificatePaths() {
  const directory = path.join(os.homedir(), '.piecemaker', 'certs');
  return {
    cert: path.join(directory, 'piecemaker-ca.crt'),
    key: path.join(directory, 'piecemaker-ca.key'),
    trustBundle: path.join(directory, 'piecemaker-trust-bundle.pem'),
  };
}

function writeTrustBundle(caFile, bundleFile) {
  const content = [...tls.rootCertificates, fs.readFileSync(caFile, 'utf8').trim()].join('\n');
  const temporary = `${bundleFile}.piecemaker-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${content}\n`, { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporary, bundleFile);
  return bundleFile;
}

function removeLegacyCentralMapping(homeDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(homeDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('central-mapping.json')) fs.rmSync(path.join(homeDir, name), { force: true });
  }
}

function installCursorGuard({ binDir, mappingFile }) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, 'cursor-agent');
  const script = `#!/bin/sh
if [ -s ${JSON.stringify(mappingFile)} ]; then
  printf '%s\\n' ${JSON.stringify(CURSOR_REFUSAL)} >&2
  exit 78
fi
PATH=$(printf '%s' "$PATH" | sed -e "s|^${binDir.replace(/[|\\]/g, '\\$&')}:||")
export PATH
exec cursor-agent "$@"
`;
  fs.writeFileSync(file, script, { encoding: 'utf8', mode: 0o755 });
  return { file };
}

function waitForListening(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const finish = (error, port) => {
      clearTimeout(timer);
      child.stdout.off('data', take);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(port);
    };
    const timer = setTimeout(() => finish(new Error(`hudsucker n'a pas écouté : ${buffer}`)), timeoutMs);
    const take = (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/listening 127\.0\.0\.1:(\d+)/);
      if (match) finish(null, Number(match[1]));
    };
    const onExit = (code) => finish(new Error(`hudsucker sorti (${code}) : ${buffer}`));
    child.stdout.on('data', take);
    child.once('exit', onExit);
  });
}

function proxyEnvironment(proxyUrl, caFile, trustBundle) {
  return {
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    NODE_USE_ENV_PROXY: '1',
    NODE_EXTRA_CA_CERTS: caFile,
    SSL_CERT_FILE: trustBundle,
    CODEX_CA_CERTIFICATE: caFile,
    REQUESTS_CA_BUNDLE: trustBundle,
  };
}

function createAnonymizerService({ homeDir, userHome = os.homedir(), logger = console }) {
  const dictionary = createSqliteDictionaryLoader({ databasePath: process.env.DATABASE_PATH || path.join(homeDir, 'auth.db') });
  const harness = createHarnessJuridique({ homeDir, verifyResponses: false });
  const binDir = path.join(homeDir, 'bin');
  const state = { enabled: false, reason: 'not_started', origin: null, upstream: null, coverage: {} };
  let proxy = null;
  let bridge = null;
  let previousEnv = null;
  const killProxy = () => proxy?.kill('SIGKILL');

  async function start() {
    if (proxy) return state;
    removeLegacyProxyConfig({ userHome, homeDir });
    if (isDisabled(homeDir)) {
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

    const upstream = resolveUpstream(process.env.ANTHROPIC_BASE_URL);
    const hosts = [...new Set([...INTERCEPTED_HOSTS, new URL(upstream).hostname])];

    try {
      bridge = await startRewriterBridge({ dictionary, harness });
    } catch (error) {
      state.reason = `listen_failed: ${error.message}`;
      logger.warn?.(`[piecemaker] réécriture PII non démarrée : ${error.message}`);
      return state;
    }

    const child = spawn(binary, [
      '--listen', '127.0.0.1:0',
      '--rewriter', `http://127.0.0.1:${bridge.port}`,
      '--ca-cert', certificates.cert,
      '--ca-key', certificates.key,
      '--hosts', hosts.join(','),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', ALL_PROXY: '', https_proxy: '', http_proxy: '', all_proxy: '' },
    });
    proxy = child;
    process.once('exit', killProxy);
    child.stderr.on('data', (chunk) => logger.warn?.(`[piecemaker] hudsucker : ${String(chunk).trim()}`));
    child.once('exit', (code, signal) => {
      if (proxy === child && state.enabled) logger.warn?.(`[piecemaker] hudsucker arrêté (${code ?? signal}) : requêtes IA refusées`);
    });

    let port;
    try {
      port = await waitForListening(child, 15000);
      child.stdout.resume();
    } catch (error) {
      child.kill('SIGKILL');
      process.off('exit', killProxy);
      proxy = null;
      await bridge.close();
      bridge = null;
      state.reason = `listen_failed: ${error.message}`;
      logger.warn?.(`[piecemaker] proxy PII non démarré : ${error.message}`);
      return state;
    }

    const origin = `http://127.0.0.1:${port}`;
    const environment = proxyEnvironment(origin, certificates.cert, writeTrustBundle(certificates.cert, certificates.trustBundle));
    previousEnv = Object.fromEntries(['PATH', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', ...Object.keys(environment)]
      .map((key) => [key, process.env[key]]));
    for (const key of ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[key];
    Object.assign(process.env, environment);
    removeLegacyCentralMapping(homeDir);
    installCursorGuard({ binDir, mappingFile: path.join(homeDir, 'central-mapping.json') });
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;

    Object.assign(state, {
      enabled: true,
      reason: 'running',
      origin,
      upstream,
      coverage: COVERAGE,
    });
    logger.log?.(`[piecemaker] anonymisation active sur ${origin} (claude, codex, opencode ; cursor bloqué)`);
    return state;
  }

  async function stop() {
    if (proxy) {
      const child = proxy;
      proxy = null;
      process.off('exit', killProxy);
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    }
    if (bridge) await bridge.close();
    bridge = null;
    fs.rmSync(path.join(binDir, 'cursor-agent'), { force: true });
    if (previousEnv) {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      previousEnv = null;
    }
    dictionary.close();
    Object.assign(state, { enabled: false, reason: 'stopped', origin: null, upstream: null, coverage: {} });
  }

  function status() {
    const current = dictionary.get();
    return {
      ...state,
      listening: Boolean(proxy && proxy.exitCode === null && proxy.signalCode === null),
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
  createAnonymizerService,
  installCursorGuard,
  resolveUpstream,
  writeTrustBundle,
};
