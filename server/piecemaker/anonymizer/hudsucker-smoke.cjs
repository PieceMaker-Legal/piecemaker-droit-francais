const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');

const Database = require('better-sqlite3');

const { startRewriterWorker } = require('./rewriter-worker.cjs');

const HOST = 'api.anthropic.com';
const NAME = 'Jean Dupont';
const CODE = 'PERSONNE_PHYSIQUE_01';
const CHECK_TIMEOUT_MS = 10000;
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

function defaultBinary() {
  const name = process.platform === 'win32' ? 'piecemaker-hudsucker.exe' : 'piecemaker-hudsucker';
  return [
    path.join(__dirname, 'bin', name),
    path.join(__dirname, 'hudsucker-proxy', 'target', 'release', name),
  ].find((candidate) => fs.existsSync(candidate)) || path.join(__dirname, 'bin', name);
}

function mappingDatabase(directory) {
  const file = path.join(directory, 'auth.db');
  const database = new Database(file);
  database.exec(`
    CREATE TABLE piecemaker_nodes (project_id TEXT, id TEXT, label TEXT, PRIMARY KEY (project_id, id));
    CREATE TABLE piecemaker_mappings (project_id TEXT, node_id TEXT, real_value TEXT, masked_value TEXT, updated_at TEXT);
  `);
  database.prepare('INSERT INTO piecemaker_nodes VALUES (?, ?, ?)').run('smoke', 'n0', NAME);
  database.prepare('INSERT INTO piecemaker_mappings VALUES (?, ?, ?, ?, ?)').run('smoke', 'n0', NAME, CODE, '2026-01-01T00:00:00.000Z');
  database.close();
  return file;
}

function temporaryAuthority(directory) {
  const cert = path.join(directory, 'ca.crt');
  const key = path.join(directory, 'ca.key');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=PieceMaker Smoke CA',
    '-addext', 'basicConstraints=critical,CA:true,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ], { stdio: 'ignore' });
  return { cert, key };
}

function sseEvent(text) {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text },
  })}\n\n`;
}

function startUpstream() {
  const seen = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push(body);
      if (request.headers['x-smoke-mode'] === 'sse') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const text of ['Le client ', 'PERSONNE_', 'PHYSIQUE', '_01', ' a signé.']) response.write(sseEvent(text));
        response.end('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ echo: body }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ seen, server, port: server.address().port }));
  });
}

function sandboxProfile(directory) {
  const writable = JSON.stringify(fs.realpathSync(directory));
  return [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound)',
    '(allow network-outbound (remote ip "localhost:*"))',
    '(allow network-outbound (remote unix-socket))',
    '(deny file-write*)',
    `(allow file-write* (subpath ${writable}) (literal "/dev/null") (literal "/dev/tty"))`,
  ].join('\n');
}

function launch(binary, args, directory, sandboxed) {
  const env = {
    ...process.env,
    HOME: directory,
    USERPROFILE: directory,
    HTTPS_PROXY: '', HTTP_PROXY: '', ALL_PROXY: '', https_proxy: '', http_proxy: '', all_proxy: '',
  };
  const options = { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] };
  if (sandboxed) return spawn(SANDBOX_EXEC, ['-p', sandboxProfile(directory), binary, ...args], options);
  return spawn(binary, args, options);
}

function waitForListening(child, logs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`aucune écoute après 15 s : ${logs.text || buffer}`)), 15000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const match = buffer.match(/listening 127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      if (Number(match[1]) === 0) reject(new Error('port annoncé 0 : binaire antérieur au source, à recompiler'));
      else resolve(Number(match[1]));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`sorti (${code ?? signal}) : ${logs.text || buffer}`));
    });
  });
}

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} : délai dépassé`)), CHECK_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

function health(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/health' }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });
}

function refuseDirectResolution(hostname, _options, callback) {
  callback(new Error(`résolution directe de ${hostname} interdite : tout doit passer par le proxy`));
}

function postThroughProxy(port, ca, { body, contentType = 'application/json', mode = 'json' }) {
  return new Promise((resolve, reject) => {
    const connect = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `${HOST}:443`, headers: { host: `${HOST}:443` } });
    connect.once('error', reject);
    connect.once('connect', (answer, socket) => {
      if (answer.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`CONNECT refusé (${answer.statusCode})`));
        return;
      }
      const request = https.request({
        host: HOST,
        path: '/v1/messages',
        method: 'POST',
        lookup: refuseDirectResolution,
        headers: { 'content-type': contentType, 'content-length': Buffer.byteLength(body), 'x-smoke-mode': mode },
        createConnection: () => tls.connect({ socket, servername: HOST, ca }),
      }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          socket.destroy();
          resolve({ status: response.statusCode, body: text });
        });
      });
      request.once('error', reject);
      request.end(body);
    });
    connect.end();
  });
}

function streamedText(body) {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => {
      try {
        return JSON.parse(line.slice(6))?.delta?.text || '';
      } catch {
        return '';
      }
    })
    .join('');
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function runHudsuckerSmokeTest({ binary: requestedBinary = defaultBinary(), caCert = null, caKey = null, sandbox = true, report = () => {} } = {}) {
  const binary = path.resolve(requestedBinary);
  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    report({ name, ok, detail });
    return ok;
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hudsucker-smoke-'));
  const sandboxed = sandbox && process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC);
  let child = null;
  let bridge = null;
  let upstream = null;
  try {
    if (!fs.existsSync(binary)) {
      record('binaire présent', false, binary);
      return { ok: false, sandboxed, checks };
    }
    const authority = caCert && caKey ? { cert: caCert, key: caKey } : temporaryAuthority(directory);
    for (const file of [authority.cert, authority.key]) {
      if (!fs.existsSync(file)) {
        record('autorité locale présente', false, file);
        return { ok: false, sandboxed, checks };
      }
    }
    const ca = fs.readFileSync(authority.cert);

    bridge = await startRewriterWorker({ databasePath: mappingDatabase(directory), homeDir: directory });
    upstream = await startUpstream();

    const logs = { text: '' };
    child = launch(binary, [
      '--listen', '127.0.0.1:0',
      '--rewriter', `http://127.0.0.1:${bridge.port}`,
      '--ca-cert', authority.cert,
      '--ca-key', authority.key,
      '--hosts', HOST,
      '--upstream-map', `${HOST}=127.0.0.1:${upstream.port}`,
    ], directory, sandboxed);
    child.stderr.on('data', (chunk) => { logs.text += chunk; });

    let port;
    try {
      port = await waitForListening(child, logs);
      record('démarrage', true, `écoute sur 127.0.0.1:${port}${sandboxed ? ', dans sandbox-exec' : ''}`);
    } catch (error) {
      record('démarrage', false, error.message);
      return { ok: false, sandboxed, checks };
    }

    const step = async (name, run) => {
      try {
        const detail = await withTimeout(run(), name);
        record(name, true, detail || '');
      } catch (error) {
        record(name, false, error.message);
      }
    };

    await step('santé', async () => {
      const { status, body } = await health(port);
      if (status !== 200 || !body.includes('"rewriter":"ok"')) throw new Error(`HTTP ${status} ${body}`);
    });

    await step('anonymisation JSON aller-retour', async () => {
      const before = upstream.seen.length;
      const response = await postThroughProxy(port, ca, {
        body: JSON.stringify({ messages: [{ role: 'user', content: `Contrat de ${NAME}` }] }),
      });
      const sent = upstream.seen[before] || '';
      if (response.status !== 200) throw new Error(`HTTP ${response.status} ${response.body}`);
      if (sent.includes(NAME) || !sent.includes(CODE)) throw new Error(`le serveur distant a reçu : ${sent}`);
      if (!response.body.includes(NAME) || response.body.includes(CODE)) throw new Error(`réponse non restituée : ${response.body}`);
      return `le distant voit ${CODE}, le client lit « ${NAME} »`;
    });

    await step('flux SSE restitué', async () => {
      const response = await postThroughProxy(port, ca, { body: JSON.stringify({ stream: true, messages: [] }), mode: 'sse' });
      const text = streamedText(response.body);
      if (response.status !== 200 || text !== `Le client ${NAME} a signé.`) throw new Error(`HTTP ${response.status}, texte « ${text} »`);
    });

    await step('refus d’un corps non JSON', async () => {
      const before = upstream.seen.length;
      const response = await postThroughProxy(port, ca, { body: `Contrat de ${NAME}`, contentType: 'text/plain' });
      if (response.status !== 415 || upstream.seen.length !== before) throw new Error(`HTTP ${response.status}, transmis : ${upstream.seen.length - before}`);
    });

    await step('refus si le réécrivain tombe', async () => {
      await bridge.close();
      bridge = null;
      const before = upstream.seen.length;
      const response = await postThroughProxy(port, ca, { body: JSON.stringify({ messages: [{ role: 'user', content: NAME }] }) });
      if (response.status !== 502 || upstream.seen.length !== before) throw new Error(`HTTP ${response.status}, transmis : ${upstream.seen.length - before}`);
    });

    await step('arrêt avec son parent', async () => {
      child.stdin.end();
      if (!(await waitForExit(child, 3000))) throw new Error('toujours en vie 3 s après la fermeture de son entrée');
    });

    return { ok: checks.every((check) => check.ok), sandboxed, checks };
  } catch (error) {
    record('banc de test', false, error.message);
    return { ok: false, sandboxed, checks };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child, 2000);
    }
    if (bridge) await bridge.close();
    if (upstream) await new Promise((resolve) => upstream.server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

if (require.main === module) {
  runHudsuckerSmokeTest({
    binary: argument('--binary') || defaultBinary(),
    caCert: argument('--ca-cert'),
    caKey: argument('--ca-key'),
    sandbox: !process.argv.includes('--no-sandbox'),
    report: ({ name, ok, detail }) => console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`),
  }).then((result) => {
    process.exitCode = result.ok ? 0 : 1;
  });
}

module.exports = { runHudsuckerSmokeTest };
