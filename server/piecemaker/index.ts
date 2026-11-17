import { createRequire } from 'module';
import express from 'express';
import path from 'path';
import { pathToFileURL } from 'url';

import type { Router } from 'express';

import { getConnection, projectsDb, sessionsDb, userPreferencesDb } from '@/modules/database/index.js';
import { desktopAuthRoutes } from '@/modules/desktop-auth/index.js';
import { runDetachedChatTurn } from '@/modules/websocket/index.js';
import { createBoardRouter, createBoardService, createEtapesRouter, createEtapesService, createSuiviLocalRouter, createSuiviRouter, createSuiviService, createTachesService } from '@/modules/piecemaker-suivi/index.js';
import { providerRuntimeService, providerSkillsService, sessionsService } from '@/modules/providers/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';


import { createAgentInstructionsRouter, startAgentInstructionsMigration } from './agent-instructions.js';
import { reconcileClaudeHooks, reconcileCodexHooks, reconcileVibeHooks } from './claude-hooks.js';
import { installCustomFiles } from './custom-files.js';
import { startRequiredAnonymizer } from './anonymizer/lifecycle.js';
import { installSessionProxyRuntime } from './anonymizer/session-runtime.js';
import { installCodexPlanRuntime } from './codex-plan.js';
import { installCodexEventsRuntime } from './codex-events.js';
import { createCitationStore } from './harness/citation-store.js';
import { installChatCitationHarness } from './harness/chat-harness.js';
import { createCitationsRouter } from './harness/citations.routes.js';
import { createPieceTitleResolver } from './harness/piece-title.js';
import { installLegalCodeHarness } from './legal-code/legal-code-harness.js';
import { openLibrary, installLibraryRuntime, installLibrarySkillVisibility } from './library/index.js';
import { applyWorkspaceSkillVisibility } from './library/skill-visibility.js';
import { createKnowledgeBackend } from './knowledge/index.js';
import { declarePieceMakerServer } from './mcp-declaration.js';
import { declareBundledSkills } from './skill-declaration.js';
import { installPmCommand } from './pm-command.js';
import { installDocxCommand } from './docx-command.js';
import { createTimesheetBackend } from './timesheet/index.js';
import { createCompanySearchRouter } from './company-search.js';
import { isLoopback } from './knowledge/local-routes.js';
import { createSourceConnectors } from './source-connectors.js';
import { createCatalaCitation } from './catala-citation.js';
import { catalaScriptPath, createCatalaCitationCheck, createCatalaRouter, createCatalaUpdatedRouter } from './catala.js';
import { createSessionDossierRouter } from './session-dossier/session-dossier-routes.js';
import { createBodaccSearchRouter } from './bodacc-search.js';
import { createDocxDocumentRouter } from './docx-document.js';
import { createDocxReviewRouter } from './docx-review.js';
import { createFeatureCommentsRouter } from './feature-comments.js';
import { createExternalFileRouter, createFileLinksRouter } from './file-links.js';
import { createShellEnvironmentRouter, resolveDesktopShellEnvironment } from './shell-environment.js';
import { createInstitutionalTermsRouter, openInstitutionalTerms } from './institutional-terms.js';
import { installModelDiscovery } from './model-discovery/index.js';
import { discoverCodexModels } from './model-discovery/codex-catalog.js';
import { startProjectRegistry } from './project-registry.js';
import { createFolderHistory } from './folder-history/history.js';
import { createOpenPanelRequestsRouter, createOpenPanelsRouter } from './open-panels.js';
import { startRemoteAccess } from './remote/index.js';
import { createTelegramRouter } from './telegram/index.js';
import { createTabularReviewLocalRouter } from './tabular-review-assistant.js';
import { createMistralSdkAuthRouter, createMistralTabularBridge, installMistralSdk } from './mistral-sdk/index.js';

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
  createPieceMakerStampingLocalRouter(isLoopback: (request: express.Request) => boolean): express.Router;
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
const sourceConnectors = createSourceConnectors();
const suivi = createSuiviService(getConnection, sourceConnectors);
const board = createBoardService(getConnection, suivi);
const pmScript = pathToFileURL(path.join(applicationRoot, 'server', 'piecemaker', 'vendor', 'skills', 'Skill-PieceMaker', 'scripts', 'pm.mjs')).href;
const taches = createTachesService(piecemakerHome(), {
  open: (tache) => sessionsService.createAppSession(tache.provider as never, tache.projectPath, tache.titre).sessionId,
  run: (tache, sessionId, content) => {
    const preferences = tache.userId === null ? {} : userPreferencesDb.getPreferences(tache.userId);
    const toolsSettings = (preferences[`${tache.provider}Permissions`] ?? { allowedTools: [], disallowedTools: [], skipPermissions: false }) as { skipPermissions?: boolean };
    const turn = runDetachedChatTurn({ sessionId, userId: tache.userId, content, options: { model: tache.model, permissionMode: 'acceptEdits', toolsSettings, skipPermissions: toolsSettings.skipPermissions || false } }, { runtime: providerRuntimeService });
    return tache.type === 'redaction' ? turn.finally(() => library.refresh().catch(() => undefined)) : turn;
  },
  lastAnswer: async (sessionId) => {
    const history = await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 });
    return history.messages.filter((message) => message.kind === 'text' && message.role === 'assistant' && !message.parentToolUseId).at(-1)?.content ?? '';
  },
  pending: (sessionId) => providerRuntimeService.getPendingApprovalsForSession(sessionId) as Array<{ requestId: string; toolName: string; input: unknown }>,
  resolve: (requestId, decision) => providerRuntimeService.resolveToolApproval(requestId, decision),
});
const lastSession = (projectPath: string) => {
  try { return (getConnection().prepare('SELECT session_id FROM sessions WHERE project_path=? AND (isArchived IS NULL OR isArchived = 0) ORDER BY updated_at DESC LIMIT 1').get(projectPath) as { session_id: string } | undefined)?.session_id ?? null; } catch { return null; }
};
const etapes = createEtapesService({
  home: piecemakerHome(),
  suivi,
  taches,
  etat: async (projectPath) => (await import(pmScript) as { etatDossier(project: string): Promise<{ lignes: Array<{ nom: string; texte: string; ok: boolean }>; pret: boolean }> }).etatDossier(projectPath),
  sessionOf: lastSession,
  bibliotheque: {
    skills: () => library.store.list().filter((entry) => entry.kind === 'skill'),
    activer: (projectPath, id) => {
      library.store.setEnabled(projectPath, id, true);
      applyWorkspaceSkillVisibility(library.store, projectPath);
    },
  },
});
folderHistory.onChange(etapes.invalider);
for (const { project_path: projectPath } of suivi.projects()) etapes.invalider(projectPath);
installCodexPlanRuntime(providerRuntimeService);
installCodexEventsRuntime(providerRuntimeService, sessionsService);
installMistralSdk(providerRegistry.resolveProvider('mistral'), piecemakerHome());
installChatCitationHarness({ runtime: providerRuntimeService, sessions: sessionsService, store: citations, ensureProxy, folderHistory, pieceTitle: createPieceTitleResolver(getConnection) });
installLegalCodeHarness({ runtime: providerRuntimeService, sessions: sessionsService, applicationRoot });
const library = await openLibrary(piecemakerHome(), applicationRoot, () => projectsDb.getProjectPaths().map((row) => row.project_path));
installLibrarySkillVisibility(providerSkillsService, library.store);
installLibraryRuntime(providerRuntimeService, sessionsService, library.store);
installSessionProxyRuntime(providerRuntimeService, anonymizer, () => [...projectsDb.getProjectPaths(), ...projectsDb.getArchivedProjectPaths()]);
installModelDiscovery(providerRegistry, { discoverers: { codex: discoverCodexModels } });
const timesheet = createTimesheetBackend(piecemakerHome());
const knowledge = createKnowledgeBackend(applicationRoot);
const remoteRouter = startRemoteAccess(applicationRoot);
installCustomFiles(applicationRoot, piecemakerHome()).catch(() => undefined);
try {
  installPmCommand({ applicationRoot, piecemakerHome: piecemakerHome() });
  installDocxCommand(piecemakerHome(), applicationRoot);
} catch (error) {
  console.warn(`[piecemaker] commande pm non installée : ${error instanceof Error ? error.message : String(error)}`);
}
try {
  const hooks = reconcileClaudeHooks(applicationRoot);
  if (!hooks.ok) console.warn(`[piecemaker] hooks Claude incomplets : ${hooks.reason ?? [...(hooks.missing ?? []), ...(hooks.deprecated ?? [])].map((entry) => entry.script).join(', ')}`);
} catch (error) {
  console.warn(`[piecemaker] hooks Claude non enregistrés : ${error instanceof Error ? error.message : String(error)}`);
}
reconcileCodexHooks(applicationRoot)
  .then((hook) => { if (!hook.ok) console.warn(`[piecemaker] hooks Codex incomplets : ${hook.reason}`); })
  .catch((error) => console.warn(`[piecemaker] hooks Codex non enregistrés : ${error instanceof Error ? error.message : String(error)}`));
reconcileVibeHooks(applicationRoot)
  .then((hook) => { if (!hook.ok) console.warn(`[piecemaker] hooks Vibe incomplets : ${hook.reason}`); })
  .catch((error) => console.warn(`[piecemaker] hooks Vibe non enregistrés : ${error instanceof Error ? error.message : String(error)}`));
startAgentInstructionsMigration(() => projectsDb.getProjectPaths().map((row) => row.project_path), path.join(piecemakerHome(), 'CLAUDE.md'), (workspace) => {
  declarePieceMakerServer(workspace);
  declareBundledSkills(workspace);
});

const catalaCitations = createCatalaCitation(sourceConnectors, citations);
const localRouter = express.Router();
localRouter.use(desktopAuthRoutes());
localRouter.use(createMistralTabularBridge({ ensureProxy, runInProject: (id, run) => anonymizer.runInProject(id, run) }));
localRouter.use(knowledge.localRouter);
localRouter.use(createSuiviLocalRouter(suivi, isLoopback, board));
localRouter.use(createSessionDossierRouter(sessionsDb, isLoopback));
localRouter.use(createOpenPanelRequestsRouter());
localRouter.use(createCatalaUpdatedRouter(isLoopback, () => projectsDb.getProjectPaths().map((row) => row.project_path), createCatalaCitationCheck(catalaScriptPath(applicationRoot), catalaCitations)));
localRouter.use(vendor.createPieceMakerStampingLocalRouter(isLoopback));
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
    if (id.startsWith('catala:')) return projectsDb.getProjectPaths().some((row) => row.project_path === id.slice('catala:'.length));
    try { sessionsService.getSessionDetailsById(id); return true; } catch { return false; }
  }));
  router.use(timesheet);
  router.use('/catala', createCatalaRouter(catalaScriptPath(applicationRoot), {}, catalaCitations));
  router.use('/etapes', createEtapesRouter(etapes, taches));
  router.use('/suivi/board', createBoardRouter(board));
  router.use('/suivi', createSuiviRouter(suivi));
  router.use(createTelegramRouter());
  router.use('/library', library.router);
  router.use(knowledge.router);
  router.use(createCompanySearchRouter());
  router.use(createBodaccSearchRouter());
  router.use(createDocxDocumentRouter());
  router.use(createDocxReviewRouter(projectsDb));
  router.use(createFeatureCommentsRouter(projectsDb));
  router.use(createFileLinksRouter());
  router.use(createInstitutionalTermsRouter(institutionalTerms));
  router.use(createAgentInstructionsRouter(path.join(piecemakerHome(), 'CLAUDE.md')));
  router.use(createShellEnvironmentRouter(shellEnvironment));
  router.use(createOpenPanelsRouter(piecemakerHome()));
  router.use(remoteRouter);
  router.use(createMistralSdkAuthRouter());
  return router;
}
export type { PieceMakerRuntimeStatus };
export { createExternalFileRouter };
