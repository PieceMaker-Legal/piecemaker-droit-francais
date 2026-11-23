import path from 'node:path';

import express from 'express';

import { getConnection, getDatabasePath, projectsDb } from '@/modules/database/index.js';

import { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';

import { createOkfBackend } from '../okf/index.js';
import { migrateArborescence } from '../okf/ontology.js';
import { createIndexStore } from '../okf/index-store.js';

import { importLegacyKnowledge } from './legacy-import.js';
import { createKnowledgeLocalRouter, isLoopback } from './local-routes.js';
import { importDocumentIndexOverrides } from './overrides-import.js';
import { createKnowledgePipeline, pythonExecutable } from './pipeline.js';
import { createKnowledgeRouter } from './routes.js';
import { createKnowledgeService } from './service.js';
import { createSqlTool } from './sql-tool.js';

export function createKnowledgeBackend(applicationRoot: string) {
  let store: KnowledgeStore | null = null;
  let service: ReturnType<typeof createKnowledgeService> | null = null;
  const getStore = () => {
    if (!store) {
      store = new KnowledgeStore(getConnection());
      const report = importLegacyKnowledge(getConnection());
      if (report?.imported.length) console.info(`[piecemaker] analyses importées depuis ${report.source} : ${report.imported.join(', ')}`);
    }
    return store;
  };
  let sqlTool: ReturnType<typeof createSqlTool> | null = null;
  const getSqlTool = () => {
    if (!sqlTool) {
      sqlTool = createSqlTool({
        databasePath: getDatabasePath(),
        rename: (projectId, piecePath, name) => getService().rename(projectId, piecePath, name),
      });
      process.once('exit', () => sqlTool?.close());
    }
    return sqlTool;
  };
  const getService = () => {
    if (!service) {
      const pipeline = createKnowledgePipeline({ applicationRoot, projects: projectsDb, store: getStore() });
      service = createKnowledgeService(getStore(), projectsDb, pipeline);
    }
    return service;
  };

  const okf = createOkfBackend({
    projects: projectsDb,
    snapshot: (projectId) => getStore().snapshot(projectId),
    indexStore: createIndexStore(getConnection()),
    skillRoot: path.join(applicationRoot, 'server', 'piecemaker', 'vendor', 'skills', 'okf'),
    python: () => pythonExecutable(undefined),
    isLoopback,
  });

  try {
    const migrated = migrateArborescence((getConnection().prepare('SELECT project_path FROM projects').all() as Array<{ project_path: string }>).map((row) => row.project_path));
    if (migrated) console.info(`[piecemaker] arborescence commune reprise de ${migrated}`);
  } catch (error) {
    console.warn(`[piecemaker] reprise de l'arborescence impossible : ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    importDocumentIndexOverrides(getStore(), { listProjects: () => getConnection().prepare('SELECT project_id, project_path FROM projects').all() as Array<{ project_id: string; project_path: string }> });
  } catch (error) {
    console.warn(`[piecemaker] import des corrections de pièces impossible : ${error instanceof Error ? error.message : String(error)}`);
  }

  const router = express.Router();
  let knowledgeRouter: express.Router | null = null;
  router.use((request, response, next) => {
    if (!knowledgeRouter) knowledgeRouter = createKnowledgeRouter(getService());
    knowledgeRouter(request, response, next);
  });
  router.use(okf.router);

  const localRouter = express.Router();
  localRouter.use(okf.localRouter);
  localRouter.use(createKnowledgeLocalRouter(getService, projectsDb, getSqlTool));
  return { router, localRouter };
}
