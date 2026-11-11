import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import type { KnowledgeSnapshot } from '../../../plugins/piecemaker-dossier/src/types.js';

import type { Renamed } from './build.js';
import { buildBundle, documentsFromSnapshot, partiesFromSnapshot } from './build.js';
import { LAWYER_ACTOR, readBundle, readGraphTypes, readTypes, relationsOf, resourceOf, text } from './bundle.js';
import type { LinkInput } from './links.js';
import { addLink, removeLink } from './links.js';
import { graphGaps } from './premises.js';
import { premisesFromReviews } from './reviews.js';
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
    build(projectId);
    const projectPath = projectPathOf(projectId);
    const resources = (await options.listDocuments(projectPath)).map((filePath) => resourceOf(projectPath, filePath));
    return { erreurs: verifyBundle({ projectPath, resources, markdownOf: markdownOf(projectPath) }), contradictions: contradictions(projectPath) };
  };

  const verifyGraph = async (projectId: string) => ({ ...await verify(projectId), manques: graphGaps(projectPathOf(projectId)) });

  const read = (projectId: string) => {
    build(projectId);
    const projectPath = projectPathOf(projectId);
    return {
      types: readTypes(projectPath),
      typesGraphe: readGraphTypes(projectPath),
      fiches: readBundle(projectPath).filter((concept) => !concept.error).map((concept) => ({
        id: concept.id,
        type: text(concept.frontmatter.type),
        title: text(concept.frontmatter.title),
        description: text(concept.frontmatter.description),
        resource: text(concept.frontmatter.resource),
        date: text(concept.frontmatter.date),
        side: text(concept.frontmatter.side),
        single: concept.frontmatter.single_value === true,
        relations: Object.entries(relationsOf(concept.frontmatter)).flatMap(([relation, entries]) => entries
          .filter((entry) => !entry.dismissed)
          .map((entry) => ({ relation, target: entry.target, citation: entry.citation, origin: entry.origin, value: entry.value || '' }))),
      })),
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

  const statusFor = (error: unknown): number => error instanceof TypeError ? 400 : error instanceof Error && error.message === 'Project not found.' ? 404 : 500;
  const respond = (operation: () => unknown | Promise<unknown>, response: express.Response) => {
    Promise.resolve().then(operation).then((result) => response.json(result)).catch((error: unknown) => {
      response.status(statusFor(error)).json({ error: error instanceof Error ? error.message : 'OKF operation failed.' });
    });
  };

  const router = express.Router();
  router.get('/okf', (request, response) => respond(() => read(String(request.query.projectId || '')), response));
  router.get('/okf/verify', (request, response) => respond(() => verify(String(request.query.projectId || '')), response));
  router.post('/okf/link', express.json(), (request, response) => respond(() => link(String(request.body?.projectId || ''), request.body, LAWYER_ACTOR), response));
  router.post('/okf/unlink', express.json(), (request, response) => respond(() => unlink(String(request.body?.projectId || ''), request.body), response));

  const actions: Record<string, (projectId: string, body: LinkInput) => unknown> = { verify, 'verify-graph': verifyGraph, read, link: (projectId, body) => link(projectId, body), unlink };
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

  return { build, verify, verifyGraph, read, link, unlink, router, localRouter };
}
