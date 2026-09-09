import { createRequire } from 'module';
import path from 'path';

import type { Router } from 'express';

import { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { startRequiredAnonymizer } from './anonymizer/lifecycle.js';
import { createCitationStore } from './harness/citation-store.js';
import { installChatCitationHarness } from './harness/chat-harness.js';
import { createCitationsRouter } from './harness/citations.routes.js';
import { startLibraryBackend, installLibraryRuntime } from './library/index.js';
import { createTimesheetBackend } from './timesheet/index.js';

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
};

const vendor = createRequire(import.meta.url)(routerPath) as PieceMakerVendorModule;

export const { piecemakerHome } = vendor;
const { createAnonymizerService } = createRequire(import.meta.url)(path.join(applicationRoot, 'server/piecemaker/anonymizer/service.cjs'));
const anonymizer = createAnonymizerService({ homeDir: piecemakerHome(), required: true });
const ensureProxy = await startRequiredAnonymizer(anonymizer);
const citations = createCitationStore(piecemakerHome());
installChatCitationHarness({ runtime: providerRuntimeService, sessions: sessionsService, store: citations, ensureProxy });
const library = await startLibraryBackend(piecemakerHome(), applicationRoot);
installLibraryRuntime(providerRuntimeService, sessionsService, library);
const timesheet = createTimesheetBackend(piecemakerHome());

export function createPieceMakerRouter(options: { getRuntimeStatus?: () => PieceMakerRuntimeStatus } = {}) {
  const router = vendor.createPieceMakerRouter({ ...options, anonymizer });
  router.use(createCitationsRouter(citations, (id) => {
    try { sessionsService.getSessionDetailsById(id); return true; } catch { return false; }
  }));
  router.use(timesheet);
  return router;
}
export type { PieceMakerRuntimeStatus };
