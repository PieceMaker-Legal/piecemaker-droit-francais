import { createRequire } from 'module';
import express from 'express';
import path from 'path';

import type { Router } from 'express';

import { getConnection, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { createReasoningLocalRouter, createReasoningRouter, createReasoningService } from '@/modules/piecemaker-reasoning/index.js';
import { providerRuntimeService, providerSkillsService, sessionsService } from '@/modules/providers/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';


import { createAgentInstructionsRouter, startAgentInstructionsMigration } from './agent-instructions.js';
import { installCustomFiles } from './custom-files.js';
import { startRequiredAnonymizer } from './anonymizer/lifecycle.js';
import { installCodexPlanRuntime } from './codex-plan.js';
import { createCitationStore } from './harness/citation-store.js';
import { installChatCitationHarness } from './harness/chat-harness.js';
import { createCitationsRouter } from './harness/citations.routes.js';
import { createPieceTitleResolver } from './harness/piece-title.js';
import { locateSourcePassages } from './harness/source-passages.js';
import { installLegalCodeHarness } from './legal-code/legal-code-harness.js';
import { openLibrary, installLibraryRuntime, installLibrarySkillVisibility } from './library/index.js';
import { createKnowledgeBackend } from './knowledge/index.js';
import { declarePieceMakerServer } from './mcp-declaration.js';
import { declareBundledSkills } from './skill-declaration.js';
import { createTimesheetBackend } from './timesheet/index.js';
import { createCompanySearchRouter } from './company-search.js';
import { isLoopback } from './knowledge/local-routes.js';
import { createReasoningConnectors } from './reasoning-connectors.js';
import { createSessionDossierRouter } from './session-dossier/session-dossier-routes.js';
import { createBodaccSearchRouter } from './bodacc-search.js';
import { createDocxDocumentRouter } from './docx-document.js';
import { createExternalFileRouter, createFileLinksRouter } from './file-links.js';
import { createShellEnvironmentRouter, resolveDesktopShellEnvironment } from './shell-environment.js';
import { createInstitutionalTermsRouter, openInstitutionalTerms } from './institutional-terms.js';
import { installModelDiscovery } from './model-discovery/index.js';
import { startProjectRegistry } from './project-registry.js';
import { createFolderHistory } from './folder-history/history.js';
import { createOpenPanelRequestsRouter, createOpenPanelsRouter } from './open-panels.js';
import { startRemoteAccess } from './remote/index.js';
import { createTabularReviewLocalRouter } from './tabular-review-assistant.js';

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
  createPieceMakerRouter(options?: { getRuntimeStatus?: () => PieceMakerRuntimeStatus; anonymizer?: unknown; publishProjects?: () => void }): Router;
  piecemakerHome(): string;
  publishProjectSource(sourceId: string, folders: string[] | null, anonymizedFolders?: string[]): void;
  stopOriginalsJobs(): Promise<void>;
};

const shellEnvironment = await resolveDesktopShellEnvironment();
const vendor = createRequire(import.meta.url)(routerPath) as PieceMakerVendorModule;

export const { piecemakerHome, stopOriginalsJobs } = vendor;
const folderHistory = createFolderHistory();
const publishProjects = startProjectRegistry((sourceId, folders, anonymizedFolders) => {
  vendor.publishProjectSource(sourceId, folders, anonymizedFolders);
  folderHistory.syncFolders(projectsDb.getProjectPaths().map((row) => row.project_path));
});
const institutionalTerms = openInstitutionalTerms(getConnection(), applicationRoot);
const { createAnonymizerService } = createRequire(import.meta.url)(path.join(applicationRoot, 'server/piecemaker/anonymizer/service.cjs'));
const anonymizer = createAnonymizerService({ homeDir: piecemakerHome() });
const ensureProxy = await startRequiredAnonymizer(anonymizer);
const citations = createCitationStore(piecemakerHome());
const reasoning = createReasoningService(getConnection, createReasoningConnectors());
installCodexPlanRuntime(providerRuntimeService);
installChatCitationHarness({ runtime: providerRuntimeService, sessions: sessionsService, store: citations, ensureProxy, folderHistory, pieceTitle: createPieceTitleResolver(getConnection) });
installLegalCodeHarness({ runtime: providerRuntimeService, sessions: sessionsService, applicationRoot });
const library = await openLibrary(piecemakerHome(), applicationRoot, () => projectsDb.getProjectPaths().map((row) => row.project_path));
installLibrarySkillVisibility(providerSkillsService, library.store);
installLibraryRuntime(providerRuntimeService, sessionsService, library.store);
installModelDiscovery(providerRegistry);
const timesheet = createTimesheetBackend(piecemakerHome());
const knowledge = createKnowledgeBackend(applicationRoot);
const remoteRouter = startRemoteAccess(applicationRoot);
installCustomFiles(applicationRoot, piecemakerHome()).catch(() => undefined);
startAgentInstructionsMigration(() => projectsDb.getProjectPaths().map((row) => row.project_path), path.join(piecemakerHome(), 'CLAUDE.md'), (workspace) => {
  declarePieceMakerServer(workspace);
  declareBundledSkills(workspace);
});

const localRouter = express.Router();
localRouter.use(knowledge.localRouter);
localRouter.use(createReasoningLocalRouter(reasoning, isLoopback));
localRouter.use(createSessionDossierRouter(sessionsDb, isLoopback));
localRouter.use(createOpenPanelRequestsRouter());
localRouter.use(createTabularReviewLocalRouter({
  proxyOrigin: () => {
    const status = anonymizer.status() as { enabled?: boolean; listening?: boolean; origin?: string | null };
    return status.enabled && status.listening && status.origin ? status.origin : null;
  },
}));

export function createPieceMakerLocalRouter() {
  return localRouter;
}

export function createPieceMakerRouter(options: { getRuntimeStatus?: () => PieceMakerRuntimeStatus } = {}) {
  const router = vendor.createPieceMakerRouter({ ...options, anonymizer, publishProjects });
  router.use(createCitationsRouter(citations, (id) => {
    if (id.startsWith('raisonnement:')) return projectsDb.getProjectPaths().some((row) => row.project_path === id.slice('raisonnement:'.length));
    try { sessionsService.getSessionDetailsById(id); return true; } catch { return false; }
  }));
  router.use(timesheet);
  router.use('/reasoning', createReasoningRouter(reasoning, async (cwd, id, quote) => {
    const info = await reasoning.source(cwd, id);
    const quotes = [{ quote, verification: { verified: true } }];
    const reference = info.kind === 'decision' ? { kind: 'case' as const, decision_id: id } : info.kind === 'piece' ? { kind: 'document' as const, doc_id: id } : { kind: 'article' as const, article_id: id };
    return citations.save({ sessionId: `raisonnement:${cwd}`, title: info.title, source: info.text, citation: { ref: 1, ...reference, verified: true, quotes }, ranges: locateSourcePassages(info.text, quotes) });
  }));
  router.use('/library', library.router);
  router.use(knowledge.router);
  router.use(createCompanySearchRouter());
  router.use(createBodaccSearchRouter());
  router.use(createDocxDocumentRouter());
  router.use(createFileLinksRouter());
  router.use(createInstitutionalTermsRouter(institutionalTerms));
  router.use(createAgentInstructionsRouter(path.join(piecemakerHome(), 'CLAUDE.md')));
  router.use(createShellEnvironmentRouter(shellEnvironment));
  router.use(createOpenPanelsRouter(piecemakerHome()));
  router.use(remoteRouter);
  return router;
}
export type { PieceMakerRuntimeStatus };
export { createExternalFileRouter };
