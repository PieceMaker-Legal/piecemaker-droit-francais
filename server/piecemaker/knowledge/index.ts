import express from 'express';

import { getConnection, getDatabasePath, projectsDb } from '@/modules/database/index.js';

import { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';

import { importLegacyKnowledge } from './legacy-import.js';
import { createKnowledgeLocalRouter } from './local-routes.js';
import { importDocumentIndexOverrides } from './overrides-import.js';
import { createKnowledgePipeline } from './pipeline.js';
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

  return { router, localRouter: createKnowledgeLocalRouter(getService, projectsDb, getSqlTool) };
}
