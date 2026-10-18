import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { archiveHash, decodeArchive } from '../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/package.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const source = process.argv[2] || '/Applications/PieceMaker.app/Contents/Resources/app';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-ui-local-'));
const runtime = `desktop-${JSON.parse(await fs.readFile(path.join(source, 'package.json'))).version}`;
const originalIndex = await fs.readFile(path.join(source, 'dist/index.html'), 'utf8');
const originalHash = createHash('sha256').update(originalIndex).digest('hex');
await fs.cp(path.join(source, 'dist'), path.join(root, 'dist'), { recursive: true });
await fs.mkdir(path.join(root, 'electron-piecemaker'));
const index = (build) => originalIndex.replace('<html ', `<html data-piecemaker-ui="${build}" `)
  .replace('<body>', `<body><div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:${build === 'downloaded' ? '#166534' : '#854d0e'};color:white;text-align:center;padding:8px;font:15px system-ui">TEST LOCAL ISOLÉ — ${build === 'downloaded' ? 'interface téléchargée et vérifiée' : 'interface embarquée'} — aucun dossier réel</div>`);
await fs.writeFile(path.join(root, 'dist/index.html'), index('embedded'));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const entries = [];
async function collect(directory, prefix = '') {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) await collect(path.join(directory, item.name), `${name}/`);
    else if (item.isFile()) entries.push([name, (await fs.readFile(path.join(directory, item.name))).toString('base64')]);
    else throw new Error('Special files are not allowed in the local test');
  }
}
await collect(path.join(root, 'dist'));
function release(sequence, build = 'downloaded', overrides = {}) {
  const html = build === 'crashed'
    ? '<!doctype html><html data-piecemaker-ui="crashed"><body><div id="root"><p>Loading</p></div><script>throw new Error("Simulated startup exception")</script></body></html>'
    : build === 'broken'
    ? '<!doctype html><html data-piecemaker-ui="broken"><body><div id="root"></div></body></html>'
    : index(build);
  const archive = gzipSync(JSON.stringify(entries.map(([name, content]) => [name, name === 'index.html' ? Buffer.from(html).toString('base64') : content])));
  const sha256 = archiveHash(archive);
  const manifest = { format: 1, runtime, sequence, sha256, archive: `ui-${sha256}.json.gz`, bytes: archive.length, ...overrides };
  decodeArchive(archive, manifest);
  const payload = JSON.stringify(manifest);
  return { manifest, archive, envelope: { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') } };
}
let remote = release(1);
const requests = [];
const apiRequests = [];
const certificate = path.join(root, 'localhost.crt');
const certificateKey = path.join(root, 'localhost.key');
await fs.writeFile(path.join(root, 'openssl.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', certificateKey, '-out', certificate, '-days', '1', '-config', path.join(root, 'openssl.cnf')], { stdio: 'ignore' });
const tls = { key: await fs.readFile(certificateKey), cert: await fs.readFile(certificate) };
const feed = createSecureServer(tls, (request, response) => {
  requests.push(request.url);
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/ui-update.json') response.end(JSON.stringify(remote.envelope));
  else if (request.url === `/${remote.manifest.archive}`) response.end(remote.archive);
  else response.writeHead(404).end();
});
const backend = createServer(async (request, response) => {
  if (request.url.startsWith('/api/')) {
    apiRequests.push(request.url);
    response.setHeader('Content-Type', 'application/json');
    const fixtures = {
      '/api/auth/status': { needsSetup: false, isAuthenticated: false },
      '/api/plugins': { plugins: [] },
      '/api/projects': [],
      '/api/piecemaker/anonymizer/dictionary': { version: 0, updatedAt: null, names: [], acronyms: [] },
      '/api/piecemaker/shell-environment': { status: 'inherited' },
      '/api/taskmaster/installation-status': { installation: { isInstalled: false } },
    };
    response.end(JSON.stringify(fixtures[request.url] || {}));
    return;
  }
  const name = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, 'dist', name === '/' ? 'index.html' : `.${name}`);
  if (!file.startsWith(path.join(root, 'dist') + path.sep)) return response.writeHead(403).end();
  try {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
const sockets = new Set();
for (const server of [feed, backend]) server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
const report = { runtime, sourceIndexSha256: originalHash, phases: [], directory: root };
const electronRelative = (await fs.readFile(path.join(repository, 'node_modules/electron/path.txt'), 'utf8')).trim();
const electron = path.join(repository, 'node_modules/electron/dist', electronRelative);
let feedPort;
async function phase(details) {
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: certificate, PIECEMAKER_UI_TEST_ROOT: root,
    PIECEMAKER_UI_TEST_RUNTIME: runtime, PIECEMAKER_UI_TEST_ORIGIN: `http://127.0.0.1:${backend.address().port}`,
    PIECEMAKER_UI_TEST_PHASE: JSON.stringify(details) };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(repository, 'scripts/piecemaker/ui-updates/local-test-window.mjs')], { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Local phase failed: ${details.name} (${code})`)));
  });
  const result = JSON.parse(await fs.readFile(path.join(root, `${details.name}.json`)));
  if (!details.seed) assert.equal(result.session, 'preserved');
  if (details.allowStartupError) assert.ok(result.errors.some((message) => message.includes('Simulated startup exception')));
  else assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  report.phases.push({ name: details.name, ...result });
}

try {
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => feed.listen(0, '127.0.0.1', resolve));
  feedPort = feed.address().port;
  await fs.writeFile(path.join(root, 'electron-piecemaker/ui-update-runtime.json'), JSON.stringify({
    runtime, publicKey: publicKey.export({ type: 'spki', format: 'pem' }), feed: `https://127.0.0.1:${feedPort}`,
  }));
  await phase({ name: '01-download', build: 'embedded', current: 0, pending: 1, seed: true });
  assert.equal(requests.filter((url) => url.endsWith('.json.gz')).length, 1);
  await phase({ name: '02-activate', build: 'downloaded', current: 1, pending: 0, visible: true });
  await new Promise((resolve) => feed.close(resolve));
  await phase({ name: '03-offline', build: 'downloaded', current: 1, pending: 0, log: 'Vérification reportée' });
  await new Promise((resolve) => feed.listen(feedPort, '127.0.0.1', resolve));
  remote = release(2);
  remote.envelope.signature = Buffer.alloc(64).toString('base64');
  await phase({ name: '04-invalid-signature', build: 'downloaded', current: 1, pending: 0, log: 'Signature' });
  remote = release(3, 'downloaded', { runtime: 'desktop-0.0.0' });
  await phase({ name: '05-incompatible', build: 'downloaded', current: 1, pending: 0, log: 'incompatible' });
  remote = release(4);
  remote.archive = Buffer.from('corrupt');
  await phase({ name: '06-corrupt-archive', build: 'downloaded', current: 1, pending: 0, log: 'altérée' });
  remote = release(5, 'broken');
  await phase({ name: '07-stage-broken', build: 'downloaded', current: 1, pending: 5 });
  await phase({ name: '08-rollback', build: 'downloaded', current: 1, pending: 0, log: 'Retour automatique' });
  await phase({ name: '09-no-retry', build: 'downloaded', current: 1, pending: 0 });
  remote = release(6, 'crashed');
  await phase({ name: '10-stage-crash', build: 'downloaded', current: 1, pending: 6 });
  await phase({ name: '11-startup-exception', build: 'downloaded', current: 1, pending: 0, forbidden: 6, allowStartupError: true, log: 'Retour automatique' });
  assert.equal(createHash('sha256').update(await fs.readFile(path.join(source, 'dist/index.html'))).digest('hex'), originalHash);
  report.passed = true;
  console.log(`PASS all local integration phases. Report: ${root}/report.json`);
} finally {
  report.requests = requests;
  report.apiRequests = apiRequests;
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  for (const socket of sockets) socket.destroy();
  await Promise.all([feed, backend].map((server) => new Promise((resolve) => server.close(resolve))));
}
