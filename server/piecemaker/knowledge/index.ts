import express from 'express';

import { getConnection, projectsDb } from '@/modules/database/index.js';

import { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import { createKnowledgePipeline } from './pipeline.js';
import { createKnowledgeRouter } from './routes.js';
import { createKnowledgeService } from './service.js';

export function createKnowledgeBackend(applicationRoot: string) {
  const router = express.Router();
  let knowledgeRouter: express.Router | null = null;
  router.use((request, response, next) => {
    if (!knowledgeRouter) {
      const store = new KnowledgeStore(getConnection());
      const pipeline = createKnowledgePipeline({ applicationRoot, projects: projectsDb, store });
      knowledgeRouter = createKnowledgeRouter(createKnowledgeService(store, projectsDb, pipeline));
    }
    knowledgeRouter(request, response, next);
  });
  return router;
}
