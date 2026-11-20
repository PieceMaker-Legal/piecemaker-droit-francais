import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import express from 'express';

import type { NormalizedMessage } from '@/shared/types.js';

import { openArtifacts } from './vendor/mcp/artifacts/artifacts.mjs';
import { openArtifactReviews } from './vendor/mcp/artifacts/reviews.mjs';
import { openStore } from './vendor/mcp/features/store.mjs';

type Projects = { getProjectPathById(id: string): string | null; getProjectPaths(): Array<{ project_path: string }> };
type Failure = { code?: string; message: string };
type ArtifactSessions = {
  getSessionById(id: string): { project_path: string | null; created_at: string; forked_from_session_id: string | null } | null;
  fetchHistory(id: string): Promise<{ messages: NormalizedMessage[] }>;
};

const OWNER = /^[a-z][a-z0-9-]{2,63}$/;
const STORE_OPTIONS = { base: ['.piecemaker', 'artifacts'], namePattern: OWNER, views: false };
const STATUS: Record<string, number> = { invalid_argument: 400, permission_denied: 403, not_found: 404, conflict: 409, resource_exhausted: 413, failed_precondition: 412, unavailable: 503 };
const FRAME_TTL_MS = 60 * 60 * 1000;
const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vendor', 'mcp', 'artifacts', 'runtime.js');
const RUNTIME_PATH = '__piecemaker/runtime.js';
const CDN_SCRIPTS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdn.tailwindcss.com', 'https://code.jquery.com'];

/** Jetons d'affichage : une iframe isolée ne porte pas le jeton de session, elle porte celui-ci. */
const frames = new Map<string, { root: string; id: string; version: number; expires: number }>();

function issueFrame(root: string, id: string, version: number): string {
  const now = Date.now();
  for (const [token, frame] of frames) if (frame.expires < now) frames.delete(token);
  const token = randomBytes(24).toString('hex');
  frames.set(token, { root, id, version, expires: now + FRAME_TTL_MS });
  return token;
}

export function frameCsp(origin: string): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${origin} ${CDN_SCRIPTS.join(' ')}`,
    `style-src 'unsafe-inline' ${origin} https://fonts.googleapis.com ${CDN_SCRIPTS.join(' ')}`,
    `font-src ${origin} https://fonts.gstatic.com data:`,
    `img-src ${origin} data: blob:`,
    `media-src ${origin} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** Le runtime passe avant tout script de la page. */
export function injectRuntime(html: string): string {
  const tag = `<script src="${RUNTIME_PATH}"></script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}\n${tag}${html.slice(head.index + head[0].length)}`;
  const doctype = /<!doctype[^>]*>/i.exec(html);
  return doctype ? `${html.slice(0, doctype.index + doctype[0].length)}\n${tag}${html.slice(doctype.index + doctype[0].length)}` : `${tag}\n${html}`;
}

/** Dernière écriture dans la base d'un artifact : l'onglet prévient la page quand elle change. */
function latestChange(folder: string): number {
  if (!fs.existsSync(folder)) return 0;
  return fs.readdirSync(folder, { withFileTypes: true }).reduce((latest, entry) => {
    const file = path.join(folder, entry.name);
    return Math.max(latest, entry.isDirectory() ? latestChange(file) : fs.statSync(file).mtimeMs);
  }, 0);
}

function send(response: express.Response, promise: Promise<unknown> | unknown, status = 200) {
  void Promise.resolve(promise)
    .then((value) => response.status(status).json(value))
    .catch((error: Failure) => response.status(STATUS[error.code ?? ''] ?? 500).json({ error: error.message, code: error.code ?? null }));
}

function parseToolJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function publicationText(content: string): string {
  if (!content.startsWith('[') && !content.startsWith('{')) return content;
  const payload = parseToolJson(content) as { content?: unknown } | null;
  const blocks = Array.isArray(payload) ? payload : payload?.content;
  const text = Array.isArray(blocks) ? blocks.find((block) => block?.type === 'text')?.text : null;
  return typeof text === 'string' ? text : '';
}

async function artifactsCreatedInSession(root: string, sessionId: string, sessions: ArtifactSessions) {
  const session = sessions.getSessionById(sessionId);
  if (!session?.project_path || path.resolve(session.project_path) !== path.resolve(root)) {
    throw Object.assign(new Error('Session introuvable dans ce dossier.'), { code: 'not_found' });
  }

  if (!fs.existsSync(path.join(root, '.piecemaker', 'artifacts', 'items'))) return [];

  const { messages } = await sessions.fetchHistory(sessionId);
  const creations = new Set<string>();
  const ids = new Set<string>();
  for (const message of messages) {
    const { kind, toolName, toolId, toolResult } = message;
    if (!toolId) continue;
    if (kind === 'tool_use' && /(^|__)artifacts__Artifact$/.test(toolName ?? '')) {
      const rawInput = message.toolInput;
      const input = (typeof rawInput === 'string' ? parseToolJson(rawInput) : rawInput) as { action?: unknown; url?: unknown; asset?: unknown } | null;
      if ((input?.action === undefined || input.action === 'publish') && !input?.url && input?.asset !== true) creations.add(toolId);
    }
    if (!creations.has(toolId) || message.isError || toolResult?.isError) continue;
    const result = toolResult?.content ?? (kind === 'tool_result' ? message.content : undefined);
    const id = result && /^Artifact piecemaker:\/\/artifact\/([a-z][a-z0-9-]{2,63}) — [\s\S]*?\r?\nversion 1 of 1 · updated /.exec(publicationText(result))?.[1];
    if (id) ids.add(id);
  }

  const artifacts = openArtifacts(root);
  const items = Array.from(ids).flatMap((id) => {
    try {
      const item = artifacts.summary(artifacts.load(id));
      if (session.forked_from_session_id && Date.parse(item.created_at) < Date.parse(session.created_at)) return [];
      return [item];
    } catch (error) {
      if ((error as Failure).code === 'not_found') return [];
      throw error;
    }
  });
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createArtifactsRouter(projects: Projects, sessions: ArtifactSessions) {
  const router = express.Router();
  const rootOf = (request: express.Request, response: express.Response): string | null => {
    const wanted = typeof request.query.projectPath === 'string' ? path.resolve(request.query.projectPath) : '';
    const root = wanted
      ? projects.getProjectPaths().map((row) => row.project_path).find((known) => path.resolve(known) === wanted) ?? null
      : projects.getProjectPathById(typeof request.query.projectId === 'string' ? request.query.projectId : '');
    if (!root) response.status(404).json({ error: 'Dossier introuvable.' });
    return root;
  };
  const artifactId = (request: express.Request) => String(request.params.id);

  router.get('/artifacts', (request, response) => {
    const root = rootOf(request, response);
    if (!root) return;
    send(response, (async () => openArtifacts(root).list({ scope: request.query.scope === 'pinned' ? 'pinned' : 'mine', limit: 200 }))());
  });

  router.get('/artifacts/session/:sessionId', (request, response) => {
    const root = rootOf(request, response);
    if (root) send(response, artifactsCreatedInSession(root, String(request.params.sessionId), sessions));
  });

  router.get('/artifacts/:id', (request, response) => {
    const root = rootOf(request, response);
    if (!root) return;
    send(response, (async () => {
      const artifacts = openArtifacts(root);
      const meta = artifacts.load(artifactId(request));
      return { ...artifacts.summary(meta), versions: artifacts.list({ scope: 'versions', url: meta.id }), assets: meta.assets ?? [], data_stamp: latestChange(path.join(root, '.piecemaker', 'artifacts', 'data', meta.id)) };
    })());
  });

  router.post('/artifacts/:id/frame', (request, response) => {
    const root = rootOf(request, response);
    if (!root) return;
    send(response, (async () => {
      const artifacts = openArtifacts(root);
      const page = artifacts.read({ url: artifactId(request), ver: typeof request.query.ver === 'string' ? request.query.ver : undefined });
      return { src: `/api/piecemaker/local/artifact-frame/${issueFrame(root, page.meta.id, page.version)}/index.html`, version: page.version, capabilities: page.meta.capabilities };
    })());
  });

  router.post('/artifacts/:id/pin', express.json(), (request, response) => {
    const root = rootOf(request, response);
    if (!root) return;
    send(response, (async () => openArtifacts(root).pin(artifactId(request), Boolean(request.body?.pinned)))());
  });

  router.delete('/artifacts/:id', (request, response) => {
    const root = rootOf(request, response);
    if (!root) return;
    send(response, (async () => openArtifacts(root).remove({ url: artifactId(request) }))());
  });

  /** Base de l'artifact, pour sa page : refusée si la page n'a pas déclaré la capability db. */
  router.post('/artifacts/:id/data', express.json({ limit: '1mb' }), (request, response) => {
    const root = rootOf(request, response);
    if (!root) return;
    send(response, (async () => {
      const meta = openArtifacts(root).load(artifactId(request));
      if (!meta.capabilities?.db) throw Object.assign(new Error('this artifact does not declare the db capability.'), { code: 'permission_denied' });
      const store = openStore(root, STORE_OPTIONS);
      const { op, args = {} } = request.body ?? {};
      const target = () => `${args.collection}/${args.doc_id}`;
      const options = args.if_version === undefined || args.if_version === null ? {} : { if_version: args.if_version };
      switch (op) {
        case 'get': return store.get(meta.id, target());
        case 'list': return store.list(meta.id, args.collection, args.query);
        case 'query': return store.query(meta.id, args.collection, args.query);
        case 'set': return store.set(meta.id, target(), args.data, options);
        case 'update': return store.update(meta.id, target(), args.data, options);
        case 'str_replace': return store.strReplace(meta.id, target(), args.field, args.old_str, args.new_str, { ...options, replace_all: args.replace_all });
        case 'delete': return store.delete(meta.id, target(), options);
        case 'batch': return store.batch(meta.id, (Array.isArray(args.writes) ? args.writes : []).map((write: Record<string, unknown>) => ({ op: write.op, path: `${write.collection}/${write.doc_id}`, data: write.data, ...(write.if_version ? { if_version: write.if_version } : {}) })));
        default: throw Object.assign(new Error(`unknown operation "${op}".`), { code: 'invalid_argument' });
      }
    })());
  });

  router.get('/artifacts/:id/comments', (request, response) => {
    const root = rootOf(request, response);
    if (root) send(response, openArtifactReviews(root).read(artifactId(request)));
  });

  router.post('/artifacts/:id/comments', express.json({ limit: '256kb' }), (request, response) => {
    const root = rootOf(request, response);
    if (root) send(response, openArtifactReviews(root).comment(artifactId(request), request.body), 201);
  });

  router.post('/artifacts/:id/reviews', express.json({ limit: '256kb' }), (request, response) => {
    const root = rootOf(request, response);
    if (root) send(response, openArtifactReviews(root).decide(artifactId(request), request.body), 201);
  });

  return router;
}

/** Fichiers des artifacts pour l'iframe, hors authentification : le jeton d'affichage suffit. */
export function createArtifactFrameRouter() {
  const router = express.Router();
  router.get(/^\/artifact-frame\/([0-9a-f]{48})\/(.*)$/, (request, response) => {
    const params = request.params as unknown as Record<string, string>;
    const frame = frames.get(params[0]);
    if (!frame || frame.expires < Date.now()) return void response.status(404).end();
    const published = decodeURIComponent(params[1] || 'index.html');
    response.setHeader('Content-Security-Policy', frameCsp(`${request.protocol}://${request.get('host')}`));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    if (published === RUNTIME_PATH) return void response.type('text/javascript').send(fs.readFileSync(RUNTIME, 'utf8'));
    let served: { file: string; type: string } | null = null;
    try {
      served = openArtifacts(frame.root).servedFile(frame.id, frame.version, published);
    } catch {
      served = null;
    }
    if (!served || !fs.existsSync(served.file)) return void response.status(404).end();
    if (published === 'index.html') return void response.type('text/html').send(injectRuntime(fs.readFileSync(served.file, 'utf8')));
    response.type(served.type).send(fs.readFileSync(served.file));
  });
  return router;
}
