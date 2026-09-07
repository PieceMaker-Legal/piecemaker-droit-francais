const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const allowedPages = /^\/(?:workflows|tabular-reviews|library|assistant|projects)(?:\/|$)/;
const allowedDataEndpoints = [
  /^\/workflows(\?[^#]*)?$/,
  /^\/workflows\/[A-Za-z0-9_-]+$/,
  /^\/library\/(file|template)(\?[^#]*)?$/,
  /^\/tabular-review(\?[^#]*)?$/,
  /^\/tabular-review\/[A-Za-z0-9_-]+$/,
  /^\/quick-actions(\?[^#]*)?$/,
];

function isAllowedDataEndpoint(endpoint) {
  return typeof endpoint === 'string' && allowedDataEndpoints.some((pattern) => pattern.test(endpoint));
}

function createMikeService({ applicationRoot, homeDir }) {
  const runtimeDirectory = path.join(homeDir, 'mike');
  fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const keyFile = path.join(runtimeDirectory, 'bridge.key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  const key = fs.readFileSync(keyFile);
  const sessions = new Map();
  const provisionings = new Map();
  const port = Number(process.env.PIECEMAKER_MIKE_PORT || 3012);
  let gateway;
  let starting;

  const signature = (value) => crypto.createHmac('sha256', key).update(value).digest('base64url');
  const tokenFor = (id) => {
    const body = Buffer.from(JSON.stringify({ id, expires: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
    return `${body}.${signature(body)}`;
  };
  const sessionFor = (cookie = '') => {
    const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('pm_mike_gate='))?.slice('pm_mike_gate='.length);
    if (!token) return null;
    const [body, mac] = token.split('.');
    const expected = signature(body || '');
    if (!mac || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    try {
      const value = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (value.expires < Date.now()) return null;
      return sessions.get(value.id) || null;
    } catch { return null; }
  };

  function updateCookies(session, headers) {
    const changes = headers.getSetCookie ? headers.getSetCookie() : headers['set-cookie'] || [];
    for (const cookie of changes) {
      const first = cookie.split(';', 1)[0];
      const split = first.indexOf('=');
      const name = first.slice(0, split);
      if (!name.includes('mike-session')) continue;
      const value = first.slice(split + 1);
      if (value && !/Max-Age=0/i.test(cookie)) session.cookies.set(name, value);
      else session.cookies.delete(name);
    }
  }

  const cookieHeader = (session) => [...session.cookies].map(([name, value]) => `${name}=${value}`).join('; ');

  async function backend(session, endpoint, options = {}) {
    const response = await fetch(`http://127.0.0.1:3011${endpoint}`, {
      ...options,
      headers: { 'content-type': 'application/json', origin: `http://localhost:${port}`, cookie: cookieHeader(session), ...options.headers },
      signal: AbortSignal.timeout(30000),
    });
    updateCookies(session, response.headers);
    return response;
  }

  async function provision(id) {
    if (sessions.has(id)) return sessions.get(id);
    if (provisionings.has(id)) return provisionings.get(id);
    const operation = (async () => {
      const session = { id, cookies: new Map() };
      const name = crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 24);
      const credentials = { email: `piecemaker-${name}@local.example`, password: signature(`password:${id}`) };
      let response = await backend(session, '/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
      if (!response.ok) response = await backend(session, '/auth/signup', { method: 'POST', body: JSON.stringify(credentials) });
      if (!response.ok) throw new Error('La session locale Mike n’a pas pu être ouverte.');
      const data = await response.json();
      if (!data.user?.id) throw new Error('La session locale Mike est incomplète.');
      session.mikeUserId = data.user.id;
      const profileResponse = await backend(session, '/user/profile');
      if (!profileResponse.ok) throw new Error('Le profil local Mike n’a pas pu être chargé.');
      const configuration = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, 'compose.json'), 'utf8'));
      const secret = configuration.services.backend.environment.SUPABASE_SECRET_KEY;
      const profile = await fetch(`http://127.0.0.1:54331/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(session.mikeUserId)}`, {
        method: 'PATCH',
        headers: { apikey: secret, authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ onboarding_version: 0, display_name: 'PieceMaker', last_selected_chat_model: 'gpt-5.4', title_model: 'gpt-5.4', tabular_model: 'gpt-5.4' }),
      });
      if (!profile.ok) throw new Error('Le profil local Mike n’a pas pu être préparé.');
      sessions.set(id, session);
      return session;
    })().finally(() => provisionings.delete(id));
    provisionings.set(id, operation);
    return operation;
  }

  function proxy(request, response, session) {
    const isApi = request.url.startsWith('/api/');
    const endpoint = isApi ? request.url.slice(4) : request.url;
    const headers = { ...request.headers, host: isApi ? '127.0.0.1:3011' : '127.0.0.1:3010', cookie: cookieHeader(session), 'accept-encoding': 'identity' };
    delete headers.authorization;
    delete headers.connection;
    if (isApi) headers.origin = `http://localhost:${port}`;
    const upstream = http.request({ hostname: '127.0.0.1', port: isApi ? 3011 : 3010, path: endpoint, method: request.method, headers }, (incoming) => {
      updateCookies(session, incoming.headers);
      const outgoingHeaders = { ...incoming.headers };
      delete outgoingHeaders['set-cookie'];
      delete outgoingHeaders['x-frame-options'];
      delete outgoingHeaders['content-security-policy'];
      delete outgoingHeaders.connection;
      if (!isApi && String(incoming.headers['content-type']).includes('text/html')) {
        const chunks = [];
        let size = 0;
        incoming.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('La page Mike n’a pas pu être chargée.'); });
        incoming.on('data', (chunk) => { size += chunk.length; if (size > 12 * 1024 * 1024) incoming.destroy(new Error('Page trop volumineuse')); else chunks.push(chunk); });
        incoming.on('end', () => {
          const injection = '<link rel="stylesheet" href="/__piecemaker/embedded.css"><script src="/__piecemaker/embedded.js" defer></script>';
          const body = Buffer.from(Buffer.concat(chunks).toString('utf8').replace('</head>', `${injection}</head>`));
          delete outgoingHeaders['content-encoding'];
          delete outgoingHeaders.etag;
          outgoingHeaders['content-length'] = body.length;
          response.writeHead(incoming.statusCode, outgoingHeaders);
          response.end(body);
        });
      } else {
        response.writeHead(incoming.statusCode, outgoingHeaders);
        incoming.pipe(response);
      }
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Le service local Mike est indisponible.'); });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  }

  async function startGateway() {
    if (gateway) return;
    const server = http.createServer((request, response) => {
      const session = sessionFor(request.headers.cookie);
      if (!session) { response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Ouvrez cet espace depuis PieceMaker.'); return; }
      if (request.url === '/__piecemaker/close' && request.method === 'POST') {
        if (!session.parentOrigins.has(request.headers.origin)) { response.writeHead(403); response.end(); return; }
        sessions.delete(session.id);
        void backend(session, '/auth/logout', { method: 'POST' }).catch(() => {});
        response.writeHead(204, { 'access-control-allow-origin': request.headers.origin, 'access-control-allow-credentials': 'true', 'set-cookie': 'pm_mike_gate=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
        response.end();
        return;
      }
      const file = request.url === '/__piecemaker/embedded.js' ? 'embedded.js' : request.url === '/__piecemaker/embedded.css' ? 'embedded.css' : null;
      if (file) {
        response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/css', 'cache-control': 'no-store' });
        fs.createReadStream(path.join(applicationRoot, 'piecemaker/mike/integration', file)).pipe(response);
        return;
      }
      proxy(request, response, session);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    server.unref();
    gateway = server;
  }

  async function ready() {
    try {
      const responses = await Promise.all(['http://127.0.0.1:3011/health', 'http://127.0.0.1:3010/workflows'].map((url) => fetch(url, { signal: AbortSignal.timeout(3000) })));
      await Promise.all(responses.map((response) => response.body?.cancel()));
      return responses.every((response) => response.ok);
    } catch { return false; }
  }

  async function ensureStarted() {
    if (await ready()) { await startGateway(); return; }
    if (!starting) starting = (async () => {
      await execute(process.execPath, [path.join(applicationRoot, 'scripts/piecemaker/mike/runtime.mjs'), 'start'], { timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
      await startGateway();
    })().finally(() => { starting = null; });
    await starting;
  }

  return {
    status: async () => ({ ready: await ready(), port }),
    downloadDocument: async (id, documentId) => {
      await ensureStarted();
      const session = await provision(String(id));
      const metadataResponse = await backend(session, `/single-documents/${encodeURIComponent(documentId)}/url`);
      if (!metadataResponse.ok) throw new Error('Ce document Mike n’est pas accessible.');
      const metadata = await metadataResponse.json();
      const url = new URL(metadata.url);
      if (!['http://localhost:9010', 'http://127.0.0.1:9010'].includes(url.origin)) throw new Error('Le stockage du document est inconnu.');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('Le document Mike n’a pas pu être téléchargé.');
      return { response, filename: String(metadata.filename || 'document') };
    },
    workflows: async (id, workflowId) => {
      await ensureStarted();
      const session = await provision(String(id));
      const response = await backend(session, workflowId ? `/workflows/${encodeURIComponent(workflowId)}` : '/workflows?type=assistant');
      if (!response.ok) throw new Error('Le workflow Mike n’a pas pu être chargé.');
      return response.json();
    },
    quickActions: async (id) => {
      await ensureStarted();
      const session = await provision(String(id));
      const response = await backend(session, '/quick-actions?surface=app');
      if (!response.ok) throw new Error('Les actions rapides Mike n’ont pas pu être chargées.');
      return response.json();
    },
    data: async (id, endpoint) => {
      if (!isAllowedDataEndpoint(endpoint)) throw new Error('Cette ressource Mike n’est pas disponible.');
      await ensureStarted();
      const session = await provision(String(id));
      const response = await backend(session, endpoint);
      if (!response.ok) throw new Error('La ressource Mike est indisponible.');
      return response.json();
    },
    open: async (id, requestedPath, origin) => {
      if (typeof requestedPath !== 'string' || !allowedPages.test(requestedPath) || requestedPath.startsWith('//') || requestedPath.includes('\\')) throw new Error('Cette page Mike n’est pas disponible.');
      await ensureStarted();
      const session = await provision(String(id));
      const parent = new URL(origin);
      session.parentOrigins ||= new Set();
      session.parentOrigins.add(parent.origin);
      return { url: `http://${parent.hostname}:${port}${requestedPath}`, cookie: `pm_mike_gate=${tokenFor(String(id))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` };
    },
    close: (id) => sessions.delete(String(id)),
  };
}

module.exports = { createMikeService, isAllowedDataEndpoint };
