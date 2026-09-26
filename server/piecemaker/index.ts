import { createRequire } from 'module';
import path from 'path';

import type { Router } from 'express';

import { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';


import { startRequiredAnonymizer } from './anonymizer/lifecycle.js';
import { createCitationStore } from './harness/citation-store.js';
import { installChatCitationHarness } from './harness/chat-harness.js';
import { createCitationsRouter } from './harness/citations.routes.js';
import { openLibrary, installLibraryRuntime } from './library/index.js';
import { createKnowledgeBackend } from './knowledge/index.js';
import { createTimesheetBackend } from './timesheet/index.js';
import { createCompanySearchRouter } from './company-search.js';
import { createBodaccSearchRouter } from './bodacc-search.js';

/**
 * Point d'entrée PieceMaker. Les modules de `server/piecemaker/vendor/` sont du
 * CommonJS : `createRequire` les charge tels quels, sans les convertir ni les
 * faire passer par `tsc`.
 *
 * Le chemin est résolu depuis la racine applicative, pas depuis `__dirname` :
 * compilé, ce fichier vit sous `dist-server/server/piecemaker/`, alors que le
 * `vendor/` (CommonJS, Python, gabarits Markdown) reste dans l'arbre source.
 */
const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
const routerPath = path.join(applicationRoot, 'server', 'piecemaker', 'router.cjs');

type PieceMakerRuntimeStatus = {
  port?: number | string;
  host?: string;
  libreOffice?: boolean;
};

type PieceMakerVendorModule = {
  createPieceMakerRouter(options?: { getRuntimeStatus?: () => PieceMakerRuntimeStatus; anonymizer?: unknown }): Router;
  piecemakerHome(): string;
  stopOriginalsJobs(): Promise<void>;
};

const vendor = createRequire(import.meta.url)(routerPath) as PieceMakerVendorModule;

export const { piecemakerHome, stopOriginalsJobs } = vendor;
const { createAnonymizerService } = createRequire(import.meta.url)(path.join(applicationRoot, 'server/piecemaker/anonymizer/service.cjs'));
const anonymizer = createAnonymizerService({ homeDir: piecemakerHome(), required: true });
const ensureProxy = await startRequiredAnonymizer(anonymizer);
const citations = createCitationStore(piecemakerHome());
installChatCitationHarness({ runtime: providerRuntimeService, sessions: sessionsService, store: citations, ensureProxy });
const library = await openLibrary(piecemakerHome(), applicationRoot);
installLibraryRuntime(providerRuntimeService, sessionsService, library.store);
const timesheet = createTimesheetBackend(piecemakerHome());
const knowledge = createKnowledgeBackend(applicationRoot);

export function createPieceMakerLocalRouter() {
  return knowledge.localRouter;
}

export function createPieceMakerRouter(options: { getRuntimeStatus?: () => PieceMakerRuntimeStatus } = {}) {
  const router = vendor.createPieceMakerRouter({ ...options, anonymizer });
  router.use(createCitationsRouter(citations, (id) => {
    try { sessionsService.getSessionDetailsById(id); return true; } catch { return false; }
  }));
  router.use(timesheet);
  router.use('/library', library.router);
  router.use(knowledge.router);
  router.use(createCompanySearchRouter());
  router.use(createBodaccSearchRouter());
  return router;
}
export type { PieceMakerRuntimeStatus };
