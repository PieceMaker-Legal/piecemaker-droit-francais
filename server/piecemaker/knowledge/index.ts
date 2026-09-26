import express from 'express';

import { getConnection, projectsDb } from '@/modules/database/index.js';

import { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';

import { importLegacyKnowledge } from './legacy-import.js';
import { createKnowledgeLocalRouter } from './local-routes.js';
import { createKnowledgePipeline } from './pipeline.js';
import { createKnowledgeRouter } from './routes.js';
import { createKnowledgeService } from './service.js';

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
  const getService = () => {
    if (!service) {
      const pipeline = createKnowledgePipeline({ applicationRoot, projects: projectsDb, store: getStore() });
      service = createKnowledgeService(getStore(), projectsDb, pipeline);
    }
    return service;
  };

  const router = express.Router();
  let knowledgeRouter: express.Router | null = null;
  router.use((request, response, next) => {
    if (!knowledgeRouter) knowledgeRouter = createKnowledgeRouter(getService());
    knowledgeRouter(request, response, next);
  });

  return { router, localRouter: createKnowledgeLocalRouter(getService, projectsDb) };
}
