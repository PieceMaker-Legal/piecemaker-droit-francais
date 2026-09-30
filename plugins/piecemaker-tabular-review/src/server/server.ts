import fs from 'node:fs';
import http from 'node:http';

import type { CreateReviewRequest } from '../shared.js';
import { emptyColumns } from '../shared.js';
import { listMarkdownDocuments } from './documents.js';
import { exportReview } from './export.js';
import { assertProject, assertReviewFile, protectedProjects, registeredProjects, UserError } from './paths.js';
import { createReview, listReviews, readReview, reviewDetail, updateReview } from './reviews.js';
import { cancelJob, isRunning, pendingTasks, queueTasks, stopAllJobs } from './runner.js';
import type { RowTask } from './runner.js';
import { assertModel, assertProvider, assertProxyOrigin, probeProxy, sessionEnvironment } from './sessions.js';
import { deleteTemplate, findTemplate, readTemplates, upsertTemplate } from './templates.js';

const MAX_BODY = 2 * 1024 * 1024;
const MAX_CONCURRENCY = 8;

type Body = Record<string, unknown>;

function accessSecret(): string | null {
  try {
    const runtime = JSON.parse(fs.readFileSync(new URL('../runtime.json', import.meta.url), 'utf8')) as { secret?: unknown };
    return typeof runtime.secret === 'string' && runtime.secret.length >= 32 ? runtime.secret : null;
  } catch {
    return null;
  }
}

function concurrency(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(MAX_CONCURRENCY, Math.max(1, parsed)) : 3;
}

async function launchEnvironment(proxyOrigin: unknown): Promise<NodeJS.ProcessEnv> {
  const origin = assertProxyOrigin(proxyOrigin);
  await probeProxy(origin);
  return sessionEnvironment(origin);
}

async function createAndLaunch(body: Body) {
  const request = body as unknown as CreateReviewRequest;
  const project = assertProject(request.project);
  const template = findTemplate(request.templateId);
  const settings = { provider: assertProvider(request.provider), model: assertModel(request.model), concurrency: concurrency(request.concurrency) };
  const environment = await launchEnvironment(request.proxyOrigin);
  const { file, review } = createReview(project, template, request.title, request.rows, settings);
  await queueTasks(project, file, review.rows.map((row) => ({ rowId: row.id })), settings.concurrency, environment);
  return reviewDetail(project, file, isRunning(project, file));
}

async function retry(body: Body) {
  const project = assertProject(body.project);
  const file = String(body.file ?? '');
  assertReviewFile(project, file);
  const review = readReview(project, file);
  const running = isRunning(project, file);
  const tasks: RowTask[] = review.rows
    .filter((row) => row.status === 'error' || row.status === 'cancelled' || (!running && (row.status === 'pending' || row.status === 'running')) || emptyColumns(review, row.id).length)
    .map((row) => ({ rowId: row.id }));
  if (!pendingTasks(review, tasks).length) throw new UserError('Toutes les cellules sont déjà remplies : aucune session à lancer.');
  const environment = await launchEnvironment(body.proxyOrigin);
  await queueTasks(project, file, tasks, review.concurrency || 3, environment);
  return reviewDetail(project, file, isRunning(project, file));
}

async function run(body: Body) {
  const project = assertProject(body.project);
  const file = String(body.file ?? '');
  assertReviewFile(project, file);
  const review = readReview(project, file);
  const rowId = typeof body.rowId === 'string' ? body.rowId : null;
  const column = body.column === undefined || body.column === null ? null : Number(body.column);
  if (rowId !== null && !review.rows.some((row) => row.id === rowId)) throw new UserError('Ligne introuvable.');
  if (column !== null && !review.columns.some((entry) => entry.index === column)) throw new UserError('Colonne introuvable.');
  if (rowId === null && column === null) throw new UserError('Indiquez une cellule, une ligne ou une colonne.');
  const columns = column === null ? undefined : [column];
  const tasks: RowTask[] = (rowId === null ? review.rows.map((row) => row.id) : [rowId]).map((id) => ({ rowId: id, columns }));
  const environment = await launchEnvironment(body.proxyOrigin);
  if (body.replace === true) {
    const targets = new Set(columns ?? review.columns.map((entry) => entry.index));
    await updateReview(project, file, (current) => {
      for (const task of tasks) {
        const cells = current.cells[task.rowId];
        if (!cells) continue;
        for (const index of targets) delete cells[String(index)];
      }
    });
  }
  const queued = await queueTasks(project, file, tasks, review.concurrency || 3, environment);
  if (!queued) throw new UserError('Les cellules demandées sont déjà remplies : aucune session lancée.');
  return reviewDetail(project, file, isRunning(project, file));
}

async function route(method: string, url: URL, body: Body): Promise<unknown> {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (method === 'GET' && pathname === '/templates') return { templates: readTemplates() };
  if (method === 'PUT' && pathname === '/templates') return { templates: upsertTemplate(body.template) };
  if (method === 'DELETE' && pathname === '/templates') return { templates: deleteTemplate(url.searchParams.get('id')) };
  if (method === 'GET' && pathname === '/protected-projects') return { projects: protectedProjects() };
  if (method === 'GET' && pathname === '/documents') {
    const project = assertProject(url.searchParams.get('project'));
    return { documents: listMarkdownDocuments(project) };
  }
  if (method === 'POST' && pathname === '/reviews/list') {
    const registered = registeredProjects();
    const projects = (Array.isArray(body.projects) ? body.projects : []).filter((project): project is string => typeof project === 'string' && registered.has(project));
    return { reviews: listReviews(projects, isRunning) };
  }
  if (method === 'GET' && pathname === '/reviews/item') {
    const project = assertProject(url.searchParams.get('project'));
    const file = url.searchParams.get('file') ?? '';
    return reviewDetail(project, file, isRunning(project, file));
  }
  if (method === 'POST' && pathname === '/reviews') return createAndLaunch(body);
  if (method === 'POST' && pathname === '/reviews/retry') return retry(body);
  if (method === 'POST' && pathname === '/reviews/run') return run(body);
  if (method === 'POST' && pathname === '/reviews/cancel') {
    const project = assertProject(body.project);
    const file = String(body.file ?? '');
    assertReviewFile(project, file);
    await cancelJob(project, file);
    return reviewDetail(project, file, isRunning(project, file));
  }
  if (method === 'POST' && pathname === '/reviews/export') {
    const project = assertProject(body.project);
    return exportReview(project, String(body.file ?? ''), body.format);
  }
  throw new UserError('Commande inconnue.');
}

async function readBody(request: http.IncomingMessage): Promise<Body> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new UserError('Requête trop volumineuse.');
  }
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Body : {};
}

const secret = accessSecret();

const server = http.createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (!secret || request.headers['x-plugin-secret-access'] !== secret) {
    response.writeHead(403);
    response.end(JSON.stringify({ error: 'Accès refusé.' }));
    return;
  }
  try {
    const body = await readBody(request);
    const result = await route(request.method ?? 'GET', new URL(request.url ?? '/', 'http://localhost'), body);
    response.end(JSON.stringify(result));
  } catch (error) {
    if (!(error instanceof UserError)) process.stderr.write(`Tabular Review : ${error instanceof Error ? error.stack : String(error)}\n`);
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ ready: true, port: typeof address === 'object' && address ? address.port : 0 })}\n`);
});

const shutdown = () => {
  stopAllJobs();
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
