import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { DEFAULT_DOCUMENT_TYPES, documentIcon } from '../../../plugins/piecemaker-dossier/src/document-types.js';
import type { KnowledgeSnapshot } from '../../../plugins/piecemaker-dossier/src/types.js';
import { REVIEW_FOLDER } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import type { Renamed } from './build.js';
import { buildBundle, documentsFromIndex, documentsFromSnapshot, legacyRecords, mergeDocuments, partiesFromSnapshot } from './build.js';
import { LAWYER_ACTOR, conceptId, readBundle, readTypes, relationsOf, resourceOf, text } from './bundle.js';
import type { ExamInput, LinkInput, ReviewLinkInput } from './links.js';
import { addLink, linkReview, markExamined, removeLink, unlinkReview, unmarkExamined } from './links.js';
import { LEGAL_DOCUMENT, LOF_ATTRIBUTION, LOF_SOURCE, lofId, lofLabel, lofTerms } from './lof.js';
import { graphTypesOf, ontologyFile, readOntology, saveOntology } from './ontology.js';
import { dropProposal, proposeOntology, readProposal } from './ontology-proposal.js';
import { EXAMINED, graphReport, linkedReviews } from './premises.js';
import { documentMetadataFromReviews, reviewCatalog, reviewRowPieces } from './reviews.js';
import type { IndexStore } from './index-store.js';
import { IndexConflictError, loadIndex, writeIndexView } from './index-store.js';
import type { OkfStore } from './store.js';
import { contradictions, verifyBundle } from './verify.js';

type OkfOptions = {
  projects: {
    getProjectById(projectId: string): { project_path: string } | null;
    getProjectPath(projectPath: string): { project_id: string; project_path: string } | null;
  };
  snapshot(projectId: string): KnowledgeSnapshot;
  store: OkfStore;
  /** L'Index du dossier, rempli par l'analyse tabulaire : il fait la liste des pièces. */
  indexStore?: IndexStore;
  convertedMarkdown(projectPath: string, filePath: string): string | null;
  listDocuments(projectPath: string): Promise<string[]>;
  isLoopback(request: express.Request): boolean;
};

export function createOkfBackend(options: OkfOptions) {
  const projectPathOf = (projectId: unknown): string => {
    const project = typeof projectId === 'string' ? options.projects.getProjectById(projectId) : null;
    if (!project) throw new Error('Project not found.');
    return fs.realpathSync(project.project_path);
  };
  const markdownOf = (projectPath: string) => (resource: string) => options.convertedMarkdown(projectPath, path.join(projectPath, resource));

  const { store } = options;
  // SQLite is the source: fiches are regenerated from it after each write.
  const build = (projectId: string, renamed?: Renamed) => {
    const projectPath = projectPathOf(projectId);
    const now = new Date().toISOString();
    store.importOnce(projectId, legacyRecords(projectPath), now);
    if (renamed) store.rename(projectId, conceptId(renamed.previous), conceptId(renamed.current));
    const snapshot = options.snapshot(projectId);
    const documents = mergeDocuments(documentsFromIndex(projectPath, options.indexStore ? loadIndex(options.indexStore, projectId, projectPath)?.review : null), documentsFromSnapshot(projectPath, snapshot));
    return buildBundle({ projectPath, documents, parties: partiesFromSnapshot(snapshot), records: store.records(projectId), markdownOf: markdownOf(projectPath), now });
  };
  const target = (projectId: string) => ({ projectPath: projectPathOf(projectId), projectId, store });

  const verify = async (projectId: string) => {
    const projectPath = projectPathOf(projectId);
    const resources = (await options.listDocuments(projectPath)).map((filePath) => resourceOf(projectPath, filePath));
    return { erreurs: verifyBundle({ projectPath, resources, markdownOf: markdownOf(projectPath) }), contradictions: contradictions(projectPath), ...graphReport(projectPath) };
  };

  const ontology = (projectId: string) => {
    const projectPath = projectPathOf(projectId);
    return { ...readOntology(projectPath), lof: lofTerms().map(([id, term]) => ({ id, ...term })), attribution: LOF_ATTRIBUTION, source: LOF_SOURCE, types: readTypes(projectPath), fichier: ontologyFile(), proposition: readProposal() };
  };

  const propose = (projectId: string, body: { ontologie?: unknown }) => proposeOntology(projectPathOf(projectId), body.ontologie);

  const saveOntologyOf = (projectId: string, value: unknown) => {
    saveOntology(projectPathOf(projectId), value);
    dropProposal();
    build(projectId);
    return ontology(projectId);
  };

  const read = (projectId: string) => {
    const projectPath = projectPathOf(projectId);
    const metadata = documentMetadataFromReviews(projectPath);
    const nodes = new Map(options.snapshot(projectId).nodes.filter((node) => node.kind === 'document' && text(node.data.path)).map((node) => [resourceOf(projectPath, text(node.data.path)), node]));
    return {
      documentTypes: DEFAULT_DOCUMENT_TYPES,
      types: readTypes(projectPath),
      typesGraphe: graphTypesOf(projectPath),
      ontologie: lofTerms().filter(([, term]) => term.kind === 'objprop' || term.kind === 'dataprop').map(([, term]) => ({ name: term.label, label: term.label, inverse: (term.inverseOf || []).map(lofLabel).join(', '), kind: term.kind })),
      classes: lofTerms().filter(([, term]) => term.kind === 'class').map(([, term]) => term.label).sort(),
      fiches: readBundle(projectPath).filter((concept) => !concept.error).map((concept) => {
        const resource = text(concept.frontmatter.resource);
        const nature = text(nodes.get(resource)?.data.nature) || metadata.get(resource)?.nature || text(concept.frontmatter.nature);
        const exam = concept.frontmatter[EXAMINED] as Record<string, unknown> | undefined;
        return {
          id: concept.id,
          type: text(concept.frontmatter.type),
          title: metadata.get(resource)?.title || text(concept.frontmatter.title),
          titleCitation: metadata.get(resource)?.titleCitation || '',
          description: text(concept.frontmatter.description),
          resource,
          date: text(concept.frontmatter.date),
          nature,
          lof: text(concept.frontmatter.lof),
          icon: documentIcon(lofLabel(lofId(nature, ['class']) || (resource ? LEGAL_DOCUMENT : lofId(text(concept.frontmatter.lof), ['class']) || ''))),
          side: text(concept.frontmatter.side),
          generated: { by: text((concept.frontmatter.generated as Record<string, unknown> | undefined)?.by), at: text((concept.frontmatter.generated as Record<string, unknown> | undefined)?.at) },
          examen: exam ? { motif: text(exam.motif), by: text(exam.by), at: text(exam.at) } : null,
          revues: linkedReviews(concept).map((link) => {
            const stored = (concept.frontmatter.revues as Array<Record<string, unknown>>).find((entry) => text(entry.fichier) === link.fichier && Number(entry.colonne) === link.colonne) || {};
            return { fichier: link.fichier, colonne: link.colonne, by: text(stored.by), at: text(stored.at), ...reviewRowPieces(projectPath, link.fichier, link.colonne) };
          }),
          relations: Object.entries(relationsOf(concept.frontmatter)).flatMap(([relation, entries]) => entries
            .filter((entry) => !entry.dismissed)
            .map((entry) => ({ relation, target: entry.target, piece: entry.piece || '', citation: entry.citation, origin: entry.origin, at: entry.at || '', value: entry.value || '' }))),
        };
      }),
    };
  };

  const link = (projectId: string, input: LinkInput, origin?: string) => {
    build(projectId);
    const added = addLink(target(projectId), input, markdownOf(projectPathOf(projectId)), origin);
    build(projectId);
    return added;
  };

  const unlink = (projectId: string, input: LinkInput) => {
    build(projectId);
    const removed = removeLink(target(projectId), input);
    build(projectId);
    return removed;
  };

  const review = (projectId: string, input: ReviewLinkInput & { retirer?: unknown }, origin?: string) => {
    build(projectId);
    const result = input.retirer === true ? unlinkReview(target(projectId), input) : linkReview(target(projectId), input, origin);
    build(projectId);
    return result;
  };

  const examine = (projectId: string, input: ExamInput & { retirer?: unknown }) => {
    build(projectId);
    const result = input.retirer === true ? unmarkExamined(target(projectId), input) : markExamined(target(projectId), input);
    build(projectId);
    return result;
  };

  const statusFor = (error: unknown): number => error instanceof TypeError ? 400 : error instanceof Error && error.message === 'Project not found.' ? 404 : 500;
  const respond = (operation: () => unknown | Promise<unknown>, response: express.Response) => {
    Promise.resolve().then(operation).then((result) => response.json(result)).catch((error: unknown) => {
      response.status(statusFor(error)).json({ error: error instanceof Error ? error.message : 'OKF operation failed.' });
    });
  };

  const router = express.Router();
  router.get('/okf', (request, response) => respond(() => read(String(request.query.projectId || '')), response));
  router.get('/okf/ontologie', (request, response) => respond(() => ontology(String(request.query.projectId || '')), response));
  router.put('/okf/ontologie', express.json(), (request, response) => respond(() => saveOntologyOf(String(request.body?.projectId || ''), request.body), response));
  router.delete('/okf/ontologie/proposition', (request, response) => respond(() => { projectPathOf(String(request.query.projectId || '')); dropProposal(); return ontology(String(request.query.projectId || '')); }, response));
  router.get('/okf/verify', (request, response) => respond(() => verify(String(request.query.projectId || '')), response));
  router.post('/okf/rebuild', express.json(), (request, response) => respond(() => build(String(request.body?.projectId || '')), response));
  router.post('/okf/link', express.json(), (request, response) => respond(() => link(String(request.body?.projectId || ''), request.body, LAWYER_ACTOR), response));
  router.get('/okf/revues', (request, response) => respond(() => ({ revues: reviewCatalog(projectPathOf(String(request.query.projectId || ''))) }), response));
  router.post('/okf/revue', express.json(), (request, response) => respond(() => review(String(request.body?.projectId || ''), request.body, LAWYER_ACTOR), response));
  router.post('/okf/unlink', express.json(), (request, response) => respond(() => unlink(String(request.body?.projectId || ''), request.body), response));

  const actions: Record<string, (projectId: string, body: LinkInput) => unknown> = { verify, read, ontologie: ontology, proposer: (projectId, body) => propose(projectId, body as { ontologie?: unknown }), link: (projectId, body) => link(projectId, body), unlink, revue: (projectId, body) => review(projectId, body as ReviewLinkInput & { retirer?: unknown }), revues: (projectId) => reviewCatalog(projectPathOf(projectId)), examinee: (projectId, body) => examine(projectId, body as ExamInput & { retirer?: unknown }) };
  const localRouter = express.Router();
  localRouter.post('/okf', express.json(), (request, response) => {
    if (!options.isLoopback(request)) {
      response.status(403).json({ error: 'OKF is restricted to loopback callers.' });
      return;
    }
    respond(async () => {
      const action = actions[String(request.body?.action || '')];
      if (!action) throw new TypeError(`action inconnue. Actions : ${Object.keys(actions).join(', ')}.`);
      const project = options.projects.getProjectPath(String(request.body?.folder || '').trim());
      if (!project) throw new Error('Project not found.');
      return { resultat: await action(project.project_id, request.body) };
    }, response);
  });

  // L'Index : la Tabular Review le lit et l'écrit ici, SQLite fait foi et le .json en est régénéré.
  const rebuilds = new Map<string, ReturnType<typeof setTimeout>>();
  const rebuildSoon = (projectId: string) => {
    clearTimeout(rebuilds.get(projectId));
    rebuilds.set(projectId, setTimeout(() => {
      rebuilds.delete(projectId);
      try {
        build(projectId);
      } catch (error) {
        console.warn(`[piecemaker] index OKF non mis à jour : ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 1000));
  };
  const indexStoreOf = (): IndexStore => {
    if (!options.indexStore) throw new Error('Index indisponible.');
    return options.indexStore;
  };
  const indexProject = (folder: unknown) => {
    const project = options.projects.getProjectPath(String(folder || '').trim());
    if (!project) throw new Error('Project not found.');
    return { projectId: project.project_id, projectPath: fs.realpathSync(project.project_path) };
  };
  const readIndex = (folder: unknown) => {
    const { projectId, projectPath } = indexProject(folder);
    const stored = loadIndex(indexStoreOf(), projectId, projectPath);
    if (stored && !fs.existsSync(path.join(projectPath, REVIEW_FOLDER, stored.file))) writeIndexView(projectPath, stored.file, stored.review);
    return stored ? { fichier: stored.file, review: stored.review, revision: stored.revision } : { fichier: null, review: null, revision: 0 };
  };
  const writeIndex = (body: { folder?: unknown; fichier?: unknown; review?: unknown; revision?: unknown }) => {
    const { projectId, projectPath } = indexProject(body.folder);
    const expected = typeof body.revision === 'number' ? body.revision : undefined;
    const revision = indexStoreOf().write(projectId, String(body.fichier || ''), body.review as Parameters<IndexStore['write']>[2], expected);
    const stored = indexStoreOf().read(projectId)!;
    writeIndexView(projectPath, stored.file, stored.review);
    rebuildSoon(projectId);
    return { fichier: stored.file, revision };
  };
  const removeIndex = (folder: unknown) => {
    const { projectId } = indexProject(folder);
    indexStoreOf().remove(projectId);
    rebuildSoon(projectId);
    return { ok: true };
  };
  const loopbackOnly = (request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (options.isLoopback(request)) return next();
    response.status(403).json({ error: 'L’Index est réservé aux appels locaux.' });
  };
  const respondIndex = (operation: () => unknown, response: express.Response) => {
    Promise.resolve().then(operation).then((result) => response.json(result)).catch((error: unknown) => {
      response.status(error instanceof IndexConflictError ? 409 : statusFor(error)).json({ error: error instanceof Error ? error.message : 'Index indisponible.' });
    });
  };
  localRouter.get('/index-review', loopbackOnly, (request, response) => respondIndex(() => readIndex(request.query.folder), response));
  localRouter.put('/index-review', loopbackOnly, express.json({ limit: '64mb' }), (request, response) => respondIndex(() => writeIndex(request.body ?? {}), response));
  localRouter.delete('/index-review', loopbackOnly, (request, response) => respondIndex(() => removeIndex(request.query.folder), response));

  return { build, verify, read, readIndex, writeIndex, ontology, saveOntology: saveOntologyOf, link, unlink, router, localRouter };
}
