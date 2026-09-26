const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startRewriterBridge } = require('./rewriter-bridge.cjs');
const { createSqliteDictionaryLoader } = require('./sqlite-dictionary.cjs');

function hudsuckerBinary() {
  if (process.env.PIECEMAKER_HUDSUCKER_BIN) return process.env.PIECEMAKER_HUDSUCKER_BIN;
  return path.join(__dirname, 'hudsucker-proxy', 'target', 'release', 'piecemaker-hudsucker');
}

function makeCertificateAuthority(directory) {
  const cert = path.join(directory, 'ca.crt');
  const key = path.join(directory, 'ca.key');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '30',
    '-subj', '/CN=PieceMaker Test CA',
    '-addext', 'basicConstraints=critical,CA:true,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ], { stdio: 'ignore' });
  return { cert, key };
}

function waitForOutput(child, needle, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`hudsucker n'a pas écouté : ${buffer}`));
    }, timeoutMs);
    const take = (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes(needle)) return;
      clearTimeout(timer);
      resolve(buffer);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`hudsucker sorti (${code}) : ${buffer}`));
    });
  });
}

async function startHudsuckerSession({
  databasePath,
  upstreamPort,
  harness = null,
  hosts = ['api.anthropic.com', 'api.openai.com', 'chatgpt.com'],
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hudsucker-')),
} = {}) {
  const binary = hudsuckerBinary();
  if (!fs.existsSync(binary)) {
    throw new Error(`binaire hudsucker absent : ${binary}`);
  }
  const ca = makeCertificateAuthority(directory);
  const dictionary = createSqliteDictionaryLoader({ databasePath });
  const bridge = await startRewriterBridge({ dictionary, harness });
  const upstreamMap = hosts.map((host) => `${host}=127.0.0.1:${upstreamPort}`).join(',');
  const child = spawn(binary, [
    '--listen', '127.0.0.1:0',
    '--rewriter', `http://127.0.0.1:${bridge.port}`,
    '--ca-cert', ca.cert,
    '--ca-key', ca.key,
    '--hosts', hosts.join(','),
    '--upstream-map', upstreamMap,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '' },
  });
  let logs = '';
  child.stderr.on('data', (chunk) => { logs += chunk; });
  let port;
  try {
    port = (await waitForOutput(child, 'listening 127.0.0.1:', 15000)).match(/listening 127\.0\.0\.1:(\d+)/)[1];
  } catch (error) {
    child.kill('SIGKILL');
    await bridge.close();
    dictionary.close();
    throw error;
  }
  return {
    origin: `http://127.0.0.1:${port}`,
    caFile: ca.cert,
    stats: bridge.stats,
    child,
    bridge,
    logs: () => logs,
    async close() {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
      await bridge.close();
      dictionary.close();
    },
  };
}

async function postThrough(origin, caFile, body, route = '/v1/messages', host = 'api.anthropic.com') {
  const { ProxyAgent, fetch } = await import('undici');
  const agent = new ProxyAgent({
    uri: origin,
    requestTls: { ca: fs.readFileSync(caFile) },
  });
  const response = await fetch(`https://${host}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    dispatcher: agent,
  });
  return response.text();
}

module.exports = {
  hudsuckerBinary,
  postThrough,
  startHudsuckerSession,
};
