import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DocxDocumentConflictError, DocxReviewError, readDocxReview, runDocxReview } from '../../../../server/modules/piecemaker-docx/index.js';
import type { AiSettings } from '../shared.js';
import { PlaybookError, record, text } from '../domain/model.js';
import { assertModel, assertProvider } from '../../../piecemaker-tabular-review/src/server/runtime.js';
import { listDocuments, MAX_FILE_BYTES, readDocx } from './documents.js';
import { atomic, hash, PlaybookStore } from './store.js';
import { PlaybookJobs } from './jobs.js';

export function settingsFrom(body: Record<string, unknown>): AiSettings {
  try { return { provider: assertProvider(body.provider), model: assertModel(body.model), proxyOrigin: text(body.proxyOrigin, 200) }; }
  catch { throw new PlaybookError('Fournisseur ou modèle invalide. Choisissez un modèle disponible dans PieceMaker.'); }
}

export async function saveReviewedDocument(store: PlaybookStore, key: string, body: Record<string, unknown>) {
  const run = store.run(key);
  if (run.status !== 'completed' || run.kind !== 'review' || !run.outputHash) throw new PlaybookError('Ce traitement ne possède pas de copie Word modifiable.');
  const expected = text(body.expectedHash, 64);
  const file = store.runFile(key, 'document-revu.docx');
  if (hash(fs.readFileSync(file)) !== expected || run.outputHash !== expected) throw new PlaybookError('Le document a changé. Rechargez la copie Word avant de continuer.', 409);
  const encoded = text(body.buffer, 36 * 1024 * 1024);
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new PlaybookError('Document Word vide ou trop volumineux.');
  await readDocx(bytes);
  const findingId = body.findingId ? text(body.findingId, 100) : null;
  const finding = findingId ? run.findings.find((entry) => entry.id === findingId) : null;
  if (findingId && (!finding || finding.applied || !finding.verified || !finding.suggestedText)) throw new PlaybookError('Cette proposition ne peut pas être appliquée.', 409);
  const current = store.run(key);
  if (current.outputHash !== expected || hash(fs.readFileSync(file)) !== expected) throw new PlaybookError('Modification concurrente : rechargez le document.', 409);
  const nextHash = hash(bytes);
  const receipt = store.runFile(key, 'publication.json');
  atomic(receipt, JSON.stringify({ previousHash: expected, nextHash, findingId }));
  atomic(file, bytes);
  current.outputHash = nextHash;
  if (finding) current.findings.find((entry) => entry.id === finding.id)!.applied = true;
  store.writeRun(current);
  fs.unlinkSync(receipt);
  return { hash: current.outputHash, run: current };
}

async function bodyFrom(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 38 * 1024 * 1024) throw new PlaybookError('Requête trop volumineuse.', 413);
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return record(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new PlaybookError('Requête JSON invalide.'); }
}

export function createHandler(options: {
  secret: string;
  jobs: PlaybookJobs;
  editorStyle: () => string;
  project: (value: unknown) => string;
  protected: (project: string) => boolean;
}) {
  const projectFrom = options.project;
  const isProtected = options.protected;
  return async (request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    if (request.headers['x-plugin-secret-access'] !== options.secret) { send(401, { error: 'Accès refusé.' }); return; }
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/editor-style' && request.method === 'GET') { send(200, { css: options.editorStyle() }); return; }
      const body = await bodyFrom(request);
      const project = projectFrom(body.project ?? url.searchParams.get('project'));
      const store = new PlaybookStore(project);
      options.jobs.recover(store);
      const method = request.method;
      const parts = url.pathname.split('/').filter(Boolean);
      let result: unknown;
      let status = 200;
      if (method === 'GET' && url.pathname === '/catalog') result = { playbooks: store.list(), documents: listDocuments(project), runs: store.runs().map(({ sourceText: _text, sources: _sources, playbook, ...run }) => ({ ...run, playbook: playbook ? { id: playbook.id, name: playbook.name } : null })) };
      else if (method === 'POST' && url.pathname === '/playbooks') result = { playbook: store.save(body.playbook) };
      else if (method === 'DELETE' && parts[0] === 'playbooks' && parts[1]) { store.remove(parts[1]); result = { ok: true }; }
      else if (method === 'POST' && (url.pathname === '/imports' || url.pathname === '/reviews')) {
        if (!isProtected(project)) throw new PlaybookError('Terminez l’anonymisation du dossier avant de lancer une session IA.');
        const kind = url.pathname === '/imports' ? 'import' : 'review';
        result = { run: await options.jobs.start(store, kind, text(body.sourcePath, 2000), settingsFrom(body),
          kind === 'review' ? store.get(text(body.playbookId, 100)) : null, body.mode === 'permissive' ? 'permissive' : 'strict') };
        status = 202;
      } else if (parts[0] === 'runs' && parts[1]) {
        const key = parts[1];
        if (method === 'GET' && !parts[2]) result = { run: store.run(key) };
        else if (method === 'POST' && parts[2] === 'cancel') result = { run: options.jobs.cancel(store, key) };
        else if (method === 'POST' && parts[2] === 'retry') {
          if (!isProtected(project)) throw new PlaybookError('L’anonymisation du dossier doit être terminée.');
          result = { run: options.jobs.retry(store, key, settingsFrom(body)) }; status = 202;
        } else if (method === 'GET' && parts[2] === 'document') {
          const run = store.run(key);
          if (!run.outputHash) throw new PlaybookError('Copie Word indisponible.');
          const bytes = fs.readFileSync(store.runFile(key, 'document-revu.docx'));
          if (hash(bytes) !== run.outputHash) throw new PlaybookError('La copie Word a été modifiée hors de PieceMaker. Relancez une revue sur sa nouvelle version.', 409);
          result = { buffer: bytes.toString('base64'), hash: run.outputHash };
        } else if (method === 'PUT' && parts[2] === 'document') result = await saveReviewedDocument(store, key, body);
        else if (parts[2] === 'edits' && method === 'GET') result = await readDocxReview(project, store.runFile(key, 'document-revu.docx'));
        else if (parts[2] === 'edits' && method === 'POST') {
          const run = store.run(key);
          const file = store.runFile(key, 'document-revu.docx');
          if (run.status !== 'completed' || !run.outputHash) throw new PlaybookError('Copie Word indisponible.');
          if (run.outputHash !== body.expectedHash) throw new PlaybookError('Le document a changé. Rechargez la copie Word.', 409);
          const finding = body.findingId ? run.findings.find((entry) => entry.id === body.findingId) : null;
          if (body.findingId && (!finding || finding.applied || !finding.verified || !finding.suggestedText)) throw new PlaybookError('Proposition indisponible.', 409);
          const find = finding?.status === 'missing_required' ? finding.insertAfter : finding?.quote;
          if (finding && !find) throw new PlaybookError('Passage vérifié manquant.');
          const review = await runDocxReview(project, path.relative(project, file), {
            action: finding ? 'edit' : text(body.action, 20), edit_id: body.edit_id ? text(body.edit_id, 100) : undefined,
            expected_sha256: run.outputHash, author: 'PieceMaker · Playbook',
            edits: finding ? [{ find, replace: finding.status === 'missing_required' ? `${find}\n${finding.suggestedText}` : finding.suggestedText,
              context_before: '', context_after: '', reason: finding.analysis }] : undefined,
          });
          run.outputHash = review.sha256;
          if (finding) finding.applied = true;
          store.writeRun(run);
          result = { review, run, buffer: fs.readFileSync(file).toString('base64') };
        }
        else throw new PlaybookError('Opération inconnue.', 404);
      } else throw new PlaybookError('Opération inconnue.', 404);
      send(status, result);
    } catch (error) {
      send(error instanceof PlaybookError || error instanceof DocxReviewError ? error.status : error instanceof DocxDocumentConflictError ? 409 : 500,
        { error: error instanceof PlaybookError || error instanceof DocxReviewError || error instanceof DocxDocumentConflictError ? error.message : 'L’opération Playbooks a échoué. Vérifiez le dossier et réessayez.' });
    }
  };
}
