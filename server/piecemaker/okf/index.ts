import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { DEFAULT_DOCUMENT_TYPES, DOCUMENT_ICONS, documentIcon } from '../../../plugins/piecemaker-dossier/src/document-types.js';
import type { KnowledgeSnapshot } from '../../../plugins/piecemaker-dossier/src/types.js';

import type { Renamed } from './build.js';
import { buildBundle, documentsFromSnapshot, partiesFromSnapshot } from './build.js';
import { LAWYER_ACTOR, readBundle, readTypes, relationsOf, resourceOf, text } from './bundle.js';
import type { ExamInput, LinkInput } from './links.js';
import { addLink, markExamined, removeLink, unmarkExamined } from './links.js';
import { SYSTEM_RELATIONS, graphTypesOf, ontologyFile, readOntology, saveOntology } from './ontology.js';
import { dropProposal, ontologyLines, proposeOntology, readProposal } from './ontology-proposal.js';
import { EXAMINED, graphReport } from './premises.js';
import { documentMetadataFromReviews, premisesFromReviews } from './reviews.js';
import { contradictions, verifyBundle } from './verify.js';

type OkfOptions = {
  projects: {
    getProjectById(projectId: string): { project_path: string } | null;
    getProjectPath(projectPath: string): { project_id: string; project_path: string } | null;
  };
  snapshot(projectId: string): KnowledgeSnapshot;
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

  const build = (projectId: string, renamed?: Renamed) => {
    const projectPath = projectPathOf(projectId);
    const snapshot = options.snapshot(projectId);
    return buildBundle({ projectPath, documents: documentsFromSnapshot(projectPath, snapshot), parties: partiesFromSnapshot(snapshot), reviewPremises: premisesFromReviews(projectPath), markdownOf: markdownOf(projectPath), renamed });
  };

  const verify = async (projectId: string) => {
    const projectPath = projectPathOf(projectId);
    const resources = (await options.listDocuments(projectPath)).map((filePath) => resourceOf(projectPath, filePath));
    return { erreurs: verifyBundle({ projectPath, resources, markdownOf: markdownOf(projectPath) }), contradictions: contradictions(projectPath), ...graphReport(projectPath) };
  };

  const ontology = (projectId: string) => {
    const projectPath = projectPathOf(projectId);
    const current = readOntology(projectPath);
    const lines = current.erreur ? { lignes: {}, total: 0 } : ontologyLines(current.relations.map((relation) => relation.name));
    return { ...current, documentTypes: current.documentTypes || DEFAULT_DOCUMENT_TYPES, icones: Object.keys(DOCUMENT_ICONS), systeme: SYSTEM_RELATIONS, types: readTypes(projectPath), fichier: ontologyFile(), ...lines, proposition: readProposal() };
  };

  const propose = (projectId: string, body: { ontologie?: unknown }) => proposeOntology(projectPathOf(projectId), body.ontologie);

  const saveOntologyOf = (projectId: string, value: unknown) => {
    saveOntology(projectPathOf(projectId), value);
    dropProposal('relations');
    build(projectId);
    return ontology(projectId);
  };

  const saveTypes = (projectId: string, value: { documentTypes?: unknown }) => {
    const projectPath = projectPathOf(projectId);
    if (value.documentTypes === undefined) throw new TypeError('documentTypes : liste obligatoire.');
    saveOntology(projectPath, { relations: readOntology(projectPath).relations, documentTypes: value.documentTypes });
    dropProposal('documentTypes');
    return ontology(projectId);
  };

  const read = (projectId: string) => {
    const projectPath = projectPathOf(projectId);
    const metadata = documentMetadataFromReviews(projectPath);
    const nodes = new Map(options.snapshot(projectId).nodes.filter((node) => node.kind === 'document' && text(node.data.path)).map((node) => [resourceOf(projectPath, text(node.data.path)), node]));
    const current = readOntology(projectPath);
    return {
      documentTypes: current.documentTypes || DEFAULT_DOCUMENT_TYPES,
      types: readTypes(projectPath),
      typesGraphe: graphTypesOf(projectPath, current),
      ontologie: [...current.relations, ...SYSTEM_RELATIONS].map(({ name, label, inverse }) => ({ name, label, inverse })),
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
          icon: documentIcon(nature, current.documentTypes || DEFAULT_DOCUMENT_TYPES),
          side: text(concept.frontmatter.side),
          single: concept.frontmatter.single_value === true,
          generated: { by: text((concept.frontmatter.generated as Record<string, unknown> | undefined)?.by), at: text((concept.frontmatter.generated as Record<string, unknown> | undefined)?.at) },
          examen: exam ? { motif: text(exam.motif), by: text(exam.by), at: text(exam.at) } : null,
          relations: Object.entries(relationsOf(concept.frontmatter)).flatMap(([relation, entries]) => entries
            .filter((entry) => !entry.dismissed)
            .map((entry) => ({ relation, target: entry.target, citation: entry.citation, origin: entry.origin, at: entry.at || '', value: entry.value || '' }))),
        };
      }),
    };
  };

  const link = (projectId: string, input: LinkInput, origin?: string) => {
    build(projectId);
    const projectPath = projectPathOf(projectId);
    const added = addLink(projectPath, input, markdownOf(projectPath), origin);
    build(projectId);
    return added;
  };

  const unlink = (projectId: string, input: LinkInput) => {
    const removed = removeLink(projectPathOf(projectId), input);
    build(projectId);
    return removed;
  };

  const examine = (projectId: string, input: ExamInput & { retirer?: unknown }) => {
    build(projectId);
    const projectPath = projectPathOf(projectId);
    const result = input.retirer === true ? unmarkExamined(projectPath, input) : markExamined(projectPath, input);
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
  router.delete('/okf/ontologie/proposition', (request, response) => respond(() => { projectPathOf(String(request.query.projectId || '')); dropProposal(request.query.partie === 'documentTypes' ? 'documentTypes' : request.query.partie === 'relations' ? 'relations' : undefined); return ontology(String(request.query.projectId || '')); }, response));
  router.put('/okf/types', express.json(), (request, response) => respond(() => saveTypes(String(request.body?.projectId || ''), request.body), response));
  router.get('/okf/verify', (request, response) => respond(() => verify(String(request.query.projectId || '')), response));
  router.post('/okf/rebuild', express.json(), (request, response) => respond(() => build(String(request.body?.projectId || '')), response));
  router.post('/okf/link', express.json(), (request, response) => respond(() => link(String(request.body?.projectId || ''), request.body, LAWYER_ACTOR), response));
  router.post('/okf/unlink', express.json(), (request, response) => respond(() => unlink(String(request.body?.projectId || ''), request.body), response));

  const actions: Record<string, (projectId: string, body: LinkInput) => unknown> = { verify, read, ontologie: ontology, proposer: (projectId, body) => propose(projectId, body as { ontologie?: unknown }), link: (projectId, body) => link(projectId, body), unlink, examinee: (projectId, body) => examine(projectId, body as ExamInput & { retirer?: unknown }) };
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

  return { build, verify, read, ontology, saveOntology: saveOntologyOf, link, unlink, router, localRouter };
}
