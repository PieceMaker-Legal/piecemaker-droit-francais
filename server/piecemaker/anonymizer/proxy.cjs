/**
 * Proxy PII local — le seul point de passage entre les clients IA lancés par
 * CloudCLI (chat comme terminal) et les API des fournisseurs.
 *
 * Il remplace la passerelle LiteLLM : même garantie, sans Python, sans venv,
 * sans service de session à installer, et dans le cycle de vie du serveur
 * CloudCLI plutôt qu'à côté.
 *
 * Sens sortant  : nom réel → code. Aucun nom de partie ne quitte la machine.
 * Sens entrant  : code → nom réel. Claude Code retrouve un texte lisible, ses
 *                 outils continuent d'ouvrir les fichiers sous leur vrai nom, et
 *                 l'interface n'a plus qu'à surligner ce qui a été protégé.
 *
 * Sans mapping, le proxy est un relais transparent : le brancher ne peut pas
 * casser une installation qui n'a encore anonymisé aucun dossier.
 *
 * Une route par fournisseur, distinguée par le préfixe d'URL — la disposition
 * qu'avait LiteLLM, conservée pour que les configurations déjà écrites par
 * l'installateur restent lisibles. Un chemin qui ne correspond à aucune route
 * est refusé : router par défaut reviendrait à laisser passer non filtré ce que
 * l'on n'a pas su reconnaître.
 */
const http = require('node:http');
const https = require('node:https');

const { anonymize, deanonymize } = require('./dictionary.cjs');
const { createSseRewriter, rewriteJsonBody } = require('./rewrite.cjs');
const { createCollecteurTexte } = require('../harness/flux-sse.cjs');

const DEFAULT_UPSTREAM = 'https://api.anthropic.com';

/**
 * Routes servies par défaut. `/chatgpt` vise le point d'entrée Codex de
 * ChatGPT, où le CLI parle le protocole Responses avec l'authentification
 * ChatGPT — c'est la cible qu'employait déjà la passerelle LiteLLM.
 */
const DEFAULT_ROUTES = [
  { provider: 'claude', prefix: '/anthropic', upstream: 'https://api.anthropic.com' },
  { provider: 'codex', prefix: '/chatgpt', upstream: 'https://chatgpt.com/backend-api/codex' },
  { provider: 'opencode', prefix: '/openai', upstream: 'https://api.openai.com' },
];

/** Port fixe : une base écrite dans un fichier de configuration doit survivre à un redémarrage. */
const DEFAULT_PORT = 4111;
/** Ports de repli si le précédent est déjà pris (instance restée en vie, autre outil). */
const PORT_SCAN = 12;

/**
 * En-têtes que le proxy possède et ne relaie donc jamais tels quels. Le corps
 * change de taille à la réécriture (`content-length`), et `accept-encoding` est
 * retiré pour recevoir du texte clair : compresser en amont rendrait la
 * dé-anonymisation impossible sans décompresser tout le flux.
 */
const DROPPED_REQUEST_HEADERS = new Set(['host', 'content-length', 'accept-encoding', 'connection']);
const DROPPED_RESPONSE_HEADERS = new Set(['content-length', 'content-encoding', 'connection', 'transfer-encoding']);

function pickHeaders(source, dropped) {
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    if (dropped.has(key.toLowerCase())) continue;
    output[key] = value;
  }
  return output;
}

function readBody(stream, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error(`Corps de requête trop volumineux (> ${limitBytes} octets).`));
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function isJsonLike(contentType) {
  return /\bjson\b/i.test(String(contentType || ''));
}

function isEventStream(contentType) {
  return /text\/event-stream/i.test(String(contentType || ''));
}

/**
 * Texte assistant d'un corps JSON complet (non streamé), pour le harnais de
 * citations : formes Anthropic Messages (`content[]`, blocs `{type:'text'}`)
 * et Responses d'OpenAI (`output[].content[]`, blocs `{type:'output_text'}`).
 * Ne jette jamais : un corps illisible ou d'une autre forme renvoie `''`.
 */
function extractAssistantTextFromJson(raw) {
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return '';
    if (Array.isArray(parsed.content)) {
      return parsed.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
    }
    if (Array.isArray(parsed.output)) {
      return parsed.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .filter((block) => block?.type === 'output_text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * @param {object} options
 * @param {{ get: () => object }} options.dictionary Chargeur de mapping à chaud.
 * @param {Array<{provider: string, prefix: string, upstream: string}>} [options.routes]
 *   Table de routage ; le préfixe le plus long l'emporte.
 * @param {number} [options.port] Port préféré ; 0 = port éphémère.
 * @param {object|null} [options.harness] Harnais de citations vérifiées
 *   (`../harness/index.cjs`), absent par défaut : sans lui, le proxy se
 *   comporte exactement comme s'il n'existait pas.
 */
function createAnonymizerProxy({
  dictionary,
  routes = DEFAULT_ROUTES,
  port = DEFAULT_PORT,
  host = '127.0.0.1',
  maxBodyBytes = 64 * 1024 * 1024,
  onError = () => {},
  harness = null,
} = {}) {
  // Préfixe le plus long d'abord : `/anthropic/v1` doit gagner sur `/anthropic`
  // si les deux sont déclarés un jour.
  const table = [...routes]
    .map((route) => ({ ...route, target: new URL(route.upstream) }))
    .sort((left, right) => right.prefix.length - left.prefix.length);
  const stats = { requests: 0, anonymized: 0, deanonymized: 0, failures: 0, lastError: null };

  // Observation du harnais de citations, en espace clair des deux côtés
  // (corps brut du client à l'aller, texte livré au client au retour) — voir
  // `../harness/index.cjs`. Ne doit jamais retarder ni faire échouer une
  // requête ou une réponse déjà en cours, même si le harnais fourni est
  // défaillant (double garde : `index.cjs` ne jette déjà jamais, mais le
  // proxy ne doit dépendre de cette garantie).
  function observerRequete(rawBody, contentType, session) {
    if (!harness) return;
    try {
      harness.observerRequete(rawBody, contentType, { session });
    } catch {
      // jamais bloquant pour la requête en cours
    }
  }

  function observerReponse(texteAssistant, session) {
    if (!harness) return;
    try {
      Promise.resolve(harness.observerReponse(texteAssistant, { session })).catch(() => {});
    } catch {
      // jamais bloquant pour une réponse déjà envoyée au client
    }
  }

  function matchRoute(url) {
    return table.find((route) => url === route.prefix || url.startsWith(`${route.prefix}/`) || url.startsWith(`${route.prefix}?`));
  }

  const server = http.createServer((clientRequest, clientResponse) => {
    stats.requests += 1;
    const current = dictionary.get();

    const route = matchRoute(clientRequest.url || '');
    if (!route) {
      stats.failures += 1;
      stats.lastError = `Chemin non routé : ${clientRequest.url}`;
      clientResponse.writeHead(404, { 'content-type': 'application/json' });
      clientResponse.end(JSON.stringify({
        error: {
          type: 'piecemaker_proxy',
          message: `Aucune route d'anonymisation pour ${clientRequest.url}. Requête refusée plutôt que relayée sans filtrage.`,
        },
      }));
      return;
    }
    const { target } = route;
    const transport = target.protocol === 'http:' ? http : https;
    const forwardedPath = `${target.pathname.replace(/\/$/, '')}${clientRequest.url.slice(route.prefix.length) || '/'}`;

    void (async () => {
      let body = Buffer.alloc(0);
      try {
        body = await readBody(clientRequest, maxBodyBytes);
      } catch (error) {
        stats.failures += 1;
        stats.lastError = error.message;
        clientResponse.writeHead(413, { 'content-type': 'application/json' });
        clientResponse.end(JSON.stringify({ error: { type: 'piecemaker_proxy', message: error.message } }));
        return;
      }

      // Corps brut, AVANT anonymisation : le harnais doit voir le même texte
      // que le client a envoyé, pas les codes qui partent vers le fournisseur.
      observerRequete(body, clientRequest.headers['content-type'], route.provider);

      let outgoing = body;
      if (body.length && !current.empty && isJsonLike(clientRequest.headers['content-type'])) {
        const rewritten = rewriteJsonBody(body, (text) => anonymize(text, current));
        outgoing = Buffer.from(rewritten, 'utf8');
        if (!outgoing.equals(body)) stats.anonymized += 1;
      }

      const headers = pickHeaders(clientRequest.headers, DROPPED_REQUEST_HEADERS);
      headers.host = target.host;
      headers['accept-encoding'] = 'identity';
      if (outgoing.length) headers['content-length'] = String(outgoing.length);

      const upstreamRequest = transport.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === 'http:' ? 80 : 443),
          method: clientRequest.method,
          path: forwardedPath,
          headers,
        },
        (upstreamResponse) => {
          const responseHeaders = pickHeaders(upstreamResponse.headers, DROPPED_RESPONSE_HEADERS);
          clientResponse.writeHead(upstreamResponse.statusCode || 502, responseHeaders);

          if (current.empty) {
            // Rien à dé-anonymiser, mais le harnais observe quand même ce qui
            // est livré au client — inchangé, aucune réécriture ici.
            if (isEventStream(upstreamResponse.headers['content-type'])) {
              const collecteur = createCollecteurTexte();
              upstreamResponse.setEncoding('utf8');
              upstreamResponse.on('data', (chunk) => {
                collecteur.push(chunk);
                clientResponse.write(chunk);
              });
              upstreamResponse.on('end', () => {
                clientResponse.end();
                observerReponse(collecteur.texte(), route.provider);
              });
              upstreamResponse.on('error', () => clientResponse.end());
              return;
            }
            if (isJsonLike(upstreamResponse.headers['content-type'])) {
              const chunks = [];
              upstreamResponse.on('data', (chunk) => chunks.push(chunk));
              upstreamResponse.on('end', () => {
                const raw = Buffer.concat(chunks);
                clientResponse.end(raw);
                observerReponse(extractAssistantTextFromJson(raw), route.provider);
              });
              upstreamResponse.on('error', () => clientResponse.end());
              return;
            }
            upstreamResponse.pipe(clientResponse);
            return;
          }

          const revert = (text) => deanonymize(text, current);

          if (isEventStream(upstreamResponse.headers['content-type'])) {
            const rewriter = createSseRewriter(revert);
            const collecteur = createCollecteurTexte();
            upstreamResponse.setEncoding('utf8');
            upstreamResponse.on('data', (chunk) => {
              const out = rewriter.push(chunk);
              if (out) {
                clientResponse.write(out);
                collecteur.push(out);
              }
            });
            upstreamResponse.on('end', () => {
              const tail = rewriter.end();
              if (tail) {
                clientResponse.write(tail);
                collecteur.push(tail);
              }
              stats.deanonymized += 1;
              clientResponse.end();
              observerReponse(collecteur.texte(), route.provider);
            });
            upstreamResponse.on('error', () => clientResponse.end());
            return;
          }

          if (isJsonLike(upstreamResponse.headers['content-type'])) {
            const chunks = [];
            upstreamResponse.on('data', (chunk) => chunks.push(chunk));
            upstreamResponse.on('end', () => {
              const raw = Buffer.concat(chunks);
              const rewritten = rewriteJsonBody(raw, revert);
              stats.deanonymized += 1;
              clientResponse.end(rewritten);
              observerReponse(extractAssistantTextFromJson(rewritten), route.provider);
            });
            upstreamResponse.on('error', () => clientResponse.end());
            return;
          }

          upstreamResponse.pipe(clientResponse);
        },
      );

      upstreamRequest.on('error', (error) => {
        stats.failures += 1;
        stats.lastError = error.message;
        onError(error);
        if (clientResponse.headersSent) {
          clientResponse.end();
          return;
        }
        clientResponse.writeHead(502, { 'content-type': 'application/json' });
        clientResponse.end(JSON.stringify({
          error: { type: 'piecemaker_proxy', message: `Relais indisponible : ${error.message}` },
        }));
      });

      if (outgoing.length) upstreamRequest.write(outgoing);
      upstreamRequest.end();
    })();
  });

  function listenOn(candidate) {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once('error', onError);
      server.listen(candidate, host, () => {
        server.removeListener('error', onError);
        const address = server.address();
        resolve({ port: address.port, origin: `http://${host}:${address.port}` });
      });
    });
  }

  return {
    stats,
    routes: table.map(({ provider, prefix, target }) => ({ provider, prefix, upstream: target.origin })),
    /**
     * Écoute le port préféré, sinon les suivants, sinon un port éphémère. Les
     * configurations des fournisseurs sont réécrites à chaque démarrage : un
     * port qui change reste cohérent, il ne survit simplement pas à un serveur
     * arrêté — ce qui est le comportement voulu.
     */
    async listen() {
      const candidates = port === 0 ? [0] : [...Array(PORT_SCAN).keys()].map((offset) => port + offset).concat(0);
      let lastError = null;
      for (const candidate of candidates) {
        try {
          return await listenOn(candidate);
        } catch (error) {
          if (error.code !== 'EADDRINUSE') throw error;
          lastError = error;
        }
      }
      throw lastError;
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { DEFAULT_UPSTREAM, createAnonymizerProxy };
