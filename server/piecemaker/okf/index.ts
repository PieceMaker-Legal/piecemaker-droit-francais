import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { DEFAULT_DOCUMENT_TYPES, documentIcon } from '../../../plugins/piecemaker-dossier/src/document-types.js';
import type { KnowledgeSnapshot } from '../../../plugins/piecemaker-dossier/src/types.js';
import { REVIEW_FOLDER } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import { DOCUMENT, bundleRoot, linksOf, parseConcept, pieceOf, readBundle, readTypes, resourceOf, text, typeOf } from './bundle.js';
import { PERSONS, writePersons } from './persons.js';
import { graphTypesOf, ontologyFile, readOntology, saveOntology } from './ontology.js';
import { dropProposal, proposeOntology, readProposal } from './ontology-proposal.js';
import type { IndexStore } from './index-store.js';
import { IndexConflictError, loadIndex, writeIndexView } from './index-store.js';

type OkfOptions = {
  projects: {
    getProjectById(projectId: string): { project_path: string } | null;
    getProjectPath(projectPath: string): { project_id: string; project_path: string } | null;
  };
  snapshot(projectId: string): KnowledgeSnapshot;
  indexStore?: IndexStore;
  skillRoot: string;
  python(): string;
  isLoopback(request: express.Request): boolean;
};

export type OkfFinding = { fiche: string; erreur: string };
export type OkfReport = { erreurs: OkfFinding[]; lints: OkfFinding[]; resume: string };

const FINDING = /^(ERROR|LINT)\s+(\S.*?): (.*)$/;

export function parseValidation(output: string): OkfReport {
  const report: OkfReport = { erreurs: [], lints: [], resume: '' };
  for (const line of output.split(/\r?\n/)) {
    const match = FINDING.exec(line);
    if (match) (match[1] === 'ERROR' ? report.erreurs : report.lints).push({ fiche: match[2], erreur: match[3] });
    else if (/^\d+ file\(s\)/.test(line)) report.resume = line.trim();
  }
  return report;
}

export function premiseDate(projectPath: string, title: string) {
  const wanted = title.trim().normalize('NFC');
  const concept = readBundle(projectPath).find((entry) => !entry.error && text(entry.frontmatter.title).normalize('NFC') === wanted);
  const date = text(concept?.frontmatter.date);
  const piece = pieceOf(concept?.frontmatter.resource);
  const citation = text(concept?.frontmatter.citation);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !piece || !citation) return null;
  return { date, intitule: wanted, preuve: [{ piece, citation }] };
}

export function createOkfBackend(options: OkfOptions) {
  const projectPathOf = (projectId: unknown): string => {
    const project = typeof projectId === 'string' ? options.projects.getProjectById(projectId) : null;
    if (!project) throw new Error('Project not found.');
    return fs.realpathSync(project.project_path);
  };

  const verify = (projectId: string): Promise<OkfReport> => {
    const projectPath = projectPathOf(projectId);
    writePersons(projectPath, options.snapshot(projectId));
    const root = bundleRoot(projectPath);
    if (!fs.existsSync(path.join(root, 'index.md'))) return Promise.resolve({ erreurs: [{ fiche: 'index.md', erreur: 'bundle OKF du dossier absent : créez .piecemaker/okf/index.md (skill okf)' }], lints: [], resume: '' });
    return new Promise((resolve, reject) => {
      execFile(options.python(), ['-E', '-s', path.join(options.skillRoot, 'scripts', 'validate.py'), root, '--strict'], { timeout: 25_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        const report = parseValidation(stdout);
        if (error && !report.resume) reject(new Error(`validateur OKF indisponible : ${(stderr || error.message).trim()}`));
        else resolve(report);
      });
    });
  };

  const patterns = () => {
    const folder = path.join(options.skillRoot, 'contexte', 'patterns');
    return fs.readdirSync(folder).filter((name) => /^odp-\d+\.md$/.test(name)).sort().map((name) => {
      const { frontmatter, body } = parseConcept(fs.readFileSync(path.join(folder, name), 'utf8'));
      return { id: name.replace(/\.md$/, ''), title: text(frontmatter.title), description: text(frontmatter.description), body: body.trim() };
    });
  };

  const ontology = (projectId: string) => {
    const projectPath = projectPathOf(projectId);
    return { ...readOntology(projectPath), patterns: patterns(), types: readTypes(projectPath), fichier: ontologyFile(), proposition: readProposal() };
  };

  const propose = (projectId: string, body: { ontologie?: unknown }) => proposeOntology(projectPathOf(projectId), body.ontologie);

  const saveOntologyOf = (projectId: string, value: unknown) => {
    saveOntology(projectPathOf(projectId), value);
    dropProposal();
    return ontology(projectId);
  };

  const read = (projectId: string) => {
    const projectPath = projectPathOf(projectId);
    const types = readTypes(projectPath);
    const snapshot = options.snapshot(projectId);
    writePersons(projectPath, snapshot);
    const nodes = new Map(snapshot.nodes.filter((node) => node.kind === 'document' && text(node.data.path)).map((node) => [resourceOf(projectPath, text(node.data.path)), node]));
    const concepts = readBundle(projectPath).filter((concept) => !concept.error);
    const kindOf = new Map(concepts.map((concept) => [concept.id, text(concept.frontmatter.type)]));
    const sideOf = new Map(concepts.filter((concept) => concept.id.startsWith(`/${PERSONS}/`)).map((concept) => [concept.id, text(concept.frontmatter.side)]));
    const documentOf = new Map(concepts.filter((concept) => text(concept.frontmatter.type) === DOCUMENT).map((concept) => [pieceOf(concept.frontmatter.resource), concept.id]));
    return {
      documentTypes: DEFAULT_DOCUMENT_TYPES,
      types,
      typesGraphe: graphTypesOf(projectPath),
      fiches: concepts.map((concept) => {
        const kind = text(concept.frontmatter.type);
        const resource = pieceOf(concept.frontmatter.resource);
        const document = kind === DOCUMENT;
        const nature = text(nodes.get(resource)?.data.nature);
        return {
          id: concept.id,
          type: document ? typeOf(resource, types) : kind,
          title: text(concept.frontmatter.title),
          description: text(concept.frontmatter.description),
          resource,
          date: text(concept.frontmatter.date),
          nature,
          lof: kind,
          icon: document ? documentIcon(nature || 'legal document') : 'diamond',
          side: text(concept.frontmatter.side) || linksOf(concept.id, concept.body).map((target) => sideOf.get(target)).find(Boolean) || '',
          relations: linksOf(concept.id, concept.body).filter((target) => kindOf.has(target)).map((target) => ({ relation: kindOf.get(target)!, target, piece: documentOf.get(resource) || '', citation: text(concept.frontmatter.citation), origin: 'okf' })),
        };
      }),
    };
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

  const actions: Record<string, (projectId: string, body: Record<string, unknown>) => unknown> = { verify, read, ontologie: ontology, proposer: (projectId, body) => propose(projectId, body) };
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
    return { fichier: stored.file, revision };
  };
  const removeIndex = (folder: unknown) => {
    const { projectId } = indexProject(folder);
    indexStoreOf().remove(projectId);
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

  return { verify, read, readIndex, writeIndex, ontology, saveOntology: saveOntologyOf, router, localRouter };
}
