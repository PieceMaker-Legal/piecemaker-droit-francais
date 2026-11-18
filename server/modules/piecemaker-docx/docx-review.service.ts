import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DocxEdit, DocxEditAnnotation, DocxReview } from '../../../shared/piecemaker/docx-review.js';

import { DocxDocumentConflictError, readDocxDocumentVersion, saveDocxDocument } from './docx-document.service.js';
import { applyTrackedEdits, resolveTrackedChange } from './mike/docxTrackedChanges.js';
import { withDocxReviewLock } from './docx-review-lock.js';

const operations = new Map<string, Promise<unknown>>();

export class DocxReviewError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function sha256(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }

async function location(project: string, filename: string) {
  const root = await realpath(project);
  const file = await realpath(path.resolve(root, filename));
  if (!file.startsWith(root + path.sep) || !file.toLowerCase().endsWith('.docx')) throw new DocxReviewError('Document Word hors du dossier.', 403);
  const key = sha256(Buffer.from(path.relative(root, file)));
  const directory = path.join(root, '.piecemaker', 'word', key);
  try {
    if (!(await realpath(directory)).startsWith(root + path.sep)) throw new DocxReviewError('Historique hors du dossier.', 403);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { root, file, directory, metadata: path.join(directory, 'review.json') };
}

async function readReview(metadata: string): Promise<DocxReview> {
  try { return JSON.parse(await readFile(metadata, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { sha256: '', current_version_id: null, versions: [], annotations: [] };
  }
}

async function saveReview(target: Awaited<ReturnType<typeof location>>, review: DocxReview) {
  await mkdir(target.directory, { recursive: true });
  if (!(await realpath(target.directory)).startsWith(target.root + path.sep)) throw new DocxReviewError('Historique hors du dossier.', 403);
  const temporary = `${target.metadata}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(review, null, 2));
  await rename(temporary, target.metadata);
}

export async function readDocxReview(project: string, filename: string): Promise<DocxReview> {
  const target = await location(project, filename);
  return { ...await readReview(target.metadata), sha256: sha256(await readFile(target.file)) };
}

export async function readDocxSnapshot(project: string, filename: string, id: string): Promise<Buffer> {
  const target = await location(project, filename);
  const review = await readReview(target.metadata);
  if (!review.versions.some((version) => version.id === id)) throw new DocxReviewError('Version introuvable.', 404);
  return readFile(id === review.current_version_id ? target.file : path.join(target.directory, `${id}.docx`));
}

function editsFrom(input: unknown): DocxEdit[] {
  if (!Array.isArray(input) || !input.length || input.length > 1000) throw new DocxReviewError('Liste de modifications requise.');
  return input.map((entry) => {
    if (!entry || typeof entry !== 'object' || ['find', 'replace', 'context_before', 'context_after'].some((key) => typeof entry[key] !== 'string') || (entry.reason !== undefined && typeof entry.reason !== 'string')) throw new DocxReviewError('Modification Word invalide.');
    return { find: entry.find, replace: entry.replace, context_before: entry.context_before, context_after: entry.context_after, reason: entry.reason };
  });
}

export async function runDocxReview(project: string, filename: string, input: {
  action: string; edits?: unknown; author?: string; expected_sha256?: string; edit_id?: string;
}) {
  const target = await location(project, filename);
  const previous = operations.get(target.file) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => withDocxReviewLock(target.directory, async () => {
    const version = await readDocxDocumentVersion(target.file);
    const bytes = await readFile(target.file);
    const currentHash = sha256(bytes);
    const review = await readReview(target.metadata);
    if (input.expected_sha256 && input.expected_sha256 !== currentHash) throw new DocxDocumentConflictError('Le document a été modifié. Relisez sa version courante.');

    let output: Buffer;
    let errors: { index: number; reason: string }[] = [];
    if (input.action === 'edit') {
      const edited = await applyTrackedEdits(bytes, editsFrom(input.edits), { author: input.author?.trim() || 'PieceMaker' });
      errors = edited.errors;
      if (!edited.changes.length) throw new DocxReviewError(errors[0]?.reason || 'Aucune modification applicable.');
      await saveReview(target, review);
      if (!review.versions.length) {
        const source = { id: randomUUID(), version_number: 1, created_at: new Date().toISOString(), source: 'upload' as const };
        await writeFile(path.join(target.directory, `${source.id}.docx`), bytes);
        review.versions.push(source);
      } else if (review.current_version_id) {
        await writeFile(path.join(target.directory, `${review.current_version_id}.docx`), bytes);
      }
      const next = { id: randomUUID(), version_number: review.versions.length + 1, created_at: new Date().toISOString(), source: 'assistant_edit' as const };
      review.versions.push(next);
      review.current_version_id = next.id;
      review.annotations.push(...edited.changes.map((change): DocxEditAnnotation => ({
        edit_id: randomUUID(), version_id: next.id, change_id: change.id,
        del_w_id: change.delId, ins_w_id: change.insId, deleted_text: change.deletedText, inserted_text: change.insertedText,
        context_before: change.contextBefore, context_after: change.contextAfter, reason: change.reason, status: 'pending',
      })));
      output = edited.bytes;
    } else if (input.action === 'accept' || input.action === 'reject') {
      const edit = review.annotations.find((entry) => entry.edit_id === input.edit_id);
      if (!edit) throw new DocxReviewError('Proposition introuvable.', 404);
      if (edit.status !== 'pending') return { ...review, sha256: currentHash, errors };
      const ids = [edit.del_w_id, edit.ins_w_id].filter((id): id is string => Boolean(id));
      output = (await resolveTrackedChange(bytes, ids, input.action)).bytes;
      edit.status = input.action === 'accept' ? 'accepted' : 'rejected';
    } else throw new DocxReviewError('Commande Word inconnue.');

    await saveDocxDocument(target.file, output, version);
    review.sha256 = sha256(await readFile(target.file));
    if (review.current_version_id) await writeFile(path.join(target.directory, `${review.current_version_id}.docx`), await readFile(target.file));
    await saveReview(target, review);
    return { ...review, errors };
  }));
  operations.set(target.file, operation);
  try { return await operation; }
  finally { if (operations.get(target.file) === operation) operations.delete(target.file); }
}

export type DirectDocxRevision = {
  id: string; kind: string; revisionId: string; blockId: string; text: string;
  author?: string; date?: string; group?: string;
};

export type DirectDocxReason = { pattern?: string; replacement?: string; at?: string; reason?: string };

export async function runDirectDocxReview<T>(project: string, filename: string, options: {
  inventory(file: string): Promise<DirectDocxRevision[]>;
  mutate(file: string): Promise<T>;
  reasons: DirectDocxReason[];
}) {
  const target = await location(project, filename);
  return withDocxReviewLock(target.directory, async () => {
    if (!(await realpath(target.directory)).startsWith(target.root + path.sep)) throw new DocxReviewError('Historique hors du dossier.', 403);
    const version = await readDocxDocumentVersion(target.file);
    const before = await readFile(target.file);
    const staging = path.join(target.directory, `${randomUUID()}.docx`);
    await writeFile(staging, before);
    try {
      const fingerprint = (entry: DirectDocxRevision) => JSON.stringify([entry.kind, entry.revisionId, entry.author, entry.date, entry.text]);
      const previous = new Set((await options.inventory(staging)).map(fingerprint));
      const result = await options.mutate(staging);
      const after = await readFile(staging);
      if (sha256(before) === sha256(after)) return result;
      const revisions = (await options.inventory(staging)).filter((entry) => !previous.has(fingerprint(entry)));
      const groups = new Map<string, DirectDocxRevision[]>();
      for (const entry of revisions) {
        const key = entry.group ?? entry.id;
        groups.set(key, [...(groups.get(key) ?? []), entry]);
      }
      const review = await readReview(target.metadata);
      const next = { id: randomUUID(), version_number: review.versions.length + (review.versions.length ? 1 : 2), created_at: new Date().toISOString(), source: 'assistant_edit' as const };
      const annotations: DocxEditAnnotation[] = [];
      for (const entries of groups.values()) {
        if (entries.some((entry) => !['ins', 'del'].includes(entry.kind) || !entry.text || !/^p\d+$|^t\d+[:]/.test(entry.blockId))) continue;
        const deleted = entries.filter((entry) => entry.kind === 'del');
        const inserted = entries.filter((entry) => entry.kind === 'ins');
        if (deleted.length > 1 || inserted.length > 1) continue;
        const deletedText = deleted[0]?.text ?? '';
        const insertedText = inserted[0]?.text ?? '';
        const reasons = options.reasons.filter((entry) => entry.pattern === deletedText && entry.replacement === insertedText && (!entry.at || entry.at === entries[0].blockId));
        annotations.push({ edit_id: randomUUID(), version_id: next.id, change_id: randomUUID(),
          del_w_id: deleted[0]?.revisionId, ins_w_id: inserted[0]?.revisionId,
          deleted_text: deletedText, inserted_text: insertedText, context_before: '', context_after: '',
          reason: reasons.length === 1 ? reasons[0].reason : undefined, status: 'pending' });
      }
      if (sha256(await readFile(target.file)) !== sha256(before)) throw new DocxDocumentConflictError('Le document a été modifié ailleurs. Relisez-le avant de reprendre.');
      await saveDocxDocument(target.file, after, version);
      if (!review.versions.length) {
        const source = { id: randomUUID(), version_number: 1, created_at: new Date().toISOString(), source: 'upload' as const };
        await writeFile(path.join(target.directory, `${source.id}.docx`), before);
        review.versions.push(source);
      } else if (review.current_version_id) await writeFile(path.join(target.directory, `${review.current_version_id}.docx`), before);
      review.versions.push(next);
      review.current_version_id = next.id;
      review.annotations.push(...annotations);
      review.sha256 = sha256(await readFile(target.file));
      await writeFile(path.join(target.directory, `${next.id}.docx`), await readFile(target.file));
      await saveReview(target, review);
      return result;
    } finally { await rm(staging, { force: true }); }
  });
}
