const crypto = require('node:crypto');
const http = require('node:http');

const { anonymize, deanonymize, resolveContext } = require('./dictionary.cjs');
const { createSseRewriter, rewriteJsonBody } = require('./rewrite.cjs');
const { createCollecteurTexte } = require('../harness/flux-sse.cjs');

const MAX_BODY = 64 * 1024 * 1024;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('corps trop volumineux'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function header(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value || '';
}

function sessionProject(request, token) {
  const value = header(request, 'x-piecemaker-proxy-authorization');
  const match = /^Basic\s+(\S+)$/i.exec(value);
  if (!token || !match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;
  const secret = Buffer.from(decoded.slice(separator + 1));
  const expected = Buffer.from(token);
  if (secret.length !== expected.length || !crypto.timingSafeEqual(secret, expected)) return null;
  try {
    return decodeURIComponent(decoded.slice(0, separator));
  } catch {
    return null;
  }
}

function observeRequest(harness, body, contentType, provider) {
  if (!harness) return;
  try {
    harness.observerRequete(body, contentType, { session: provider });
  } catch {
    // une observation ne doit pas empêcher le relais
  }
}

function observeResponse(harness, text, provider) {
  if (!harness) return;
  try {
    Promise.resolve(harness.observerReponse(text, { session: provider })).catch(() => {});
  } catch {
    // une observation ne doit pas empêcher le relais
  }
}

function assistantText(raw) {
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (Array.isArray(parsed?.content)) {
      return parsed.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
    }
    if (Array.isArray(parsed?.output)) {
      return parsed.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .filter((block) => block?.type === 'output_text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
    }
  } catch {
    return '';
  }
  return '';
}

function ssePayloads(tail) {
  return String(tail || '')
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .filter((line) => line && line !== '[DONE]');
}

function startRewriterBridge({ dictionary, harness = null, token = null }) {
  const sessions = new Map();
  const stats = { requests: 0, anonymized: 0, deanonymized: 0, failures: 0, lastError: null };

  const server = http.createServer((request, response) => {
    const provider = header(request, 'x-piecemaker-provider') || 'claude';
    const projectId = sessionProject(request, token);
    const current = () => dictionary.get();
    const outbound = () => (dictionary.getForOutbound ? dictionary.getForOutbound() : dictionary.get());

    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200);
      response.end('ok');
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/request') {
      readBody(request).then((body) => {
        stats.requests += 1;
        const contentType = header(request, 'content-type') || 'application/json';
        const dict = outbound();
        const context = dict.empty ? null : resolveContext(dict, { projectId, text: body.toString('utf8') });
        const rewritten = !body.length || dict.empty
          ? body
          : Buffer.from(rewriteJsonBody(body, (text) => anonymize(text, dict, context)), 'utf8');
        if (!rewritten.equals(body)) stats.anonymized += 1;
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': rewritten.length });
        response.end(rewritten);
        setImmediate(() => observeRequest(harness, body, contentType, provider));
      }).catch((error) => {
        stats.failures += 1;
        stats.lastError = error.message;
        response.writeHead(500);
        response.end();
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/response') {
      readBody(request).then((body) => {
        const dict = current();
        const rewritten = !body.length || dict.empty
          ? body
          : Buffer.from(rewriteJsonBody(body, (text) => deanonymize(text, dict, { projectId })), 'utf8');
        if (!rewritten.equals(body)) stats.deanonymized += 1;
        observeResponse(harness, assistantText(rewritten), provider);
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': rewritten.length });
        response.end(rewritten);
      }).catch((error) => {
        stats.failures += 1;
        stats.lastError = error.message;
        response.writeHead(500);
        response.end();
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/sse') {
      const dict = current();
      const rewriter = createSseRewriter((text) => deanonymize(text, dict, { projectId }));
      const collecteur = createCollecteurTexte();
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      response.flushHeaders();
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        const out = rewriter.push(chunk);
        if (!out) return;
        response.write(out);
        collecteur.push(out);
      });
      request.on('end', () => {
        const tail = rewriter.end();
        if (tail) {
          response.write(tail);
          collecteur.push(tail);
        }
        stats.deanonymized += 1;
        response.end();
        observeResponse(harness, collecteur.texte(), provider);
      });
      request.on('error', () => response.end());
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/ws') {
      const id = header(request, 'x-piecemaker-ws');
      const direction = header(request, 'x-piecemaker-direction');
      readBody(request).then((body) => {
        const text = body.toString('utf8');
        if (direction === 'out') {
          const dict = outbound();
          const context = dict.empty ? null : resolveContext(dict, { projectId, text });
          const rewritten = dict.empty ? text : rewriteJsonBody(text, (value) => anonymize(value, dict, context));
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          response.end(rewritten);
          setImmediate(() => observeRequest(harness, body, 'application/json', provider));
          return;
        }
        const dict = current();
        let entry = sessions.get(id);
        if (!entry) {
          entry = { rewriter: createSseRewriter((value) => deanonymize(value, dict, { projectId })) };
          sessions.set(id, entry);
        }
        if (!text.includes('\n')) {
          const payloads = ssePayloads(entry.rewriter.push(`data: ${text}\n\n`));
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          response.end(payloads.join('\n'));
          return;
        }
        const rewritten = dict.empty ? text : rewriteJsonBody(text, (value) => deanonymize(value, dict, { projectId }));
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(rewritten);
      }).catch(() => {
        response.writeHead(500);
        response.end();
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/ws-end') {
      const id = header(request, 'x-piecemaker-ws');
      const entry = sessions.get(id);
      sessions.delete(id);
      const messages = entry ? ssePayloads(entry.rewriter.end()) : [];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ messages }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
  server.requestTimeout = 0;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        stats,
        close() {
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

module.exports = { startRewriterBridge };
