import { createRequire } from 'module';
import express from 'express';
import path from 'path';
import { pathToFileURL } from 'url';

import type { Router } from 'express';

import { getConnection, projectsDb, sessionsDb, userPreferencesDb } from '@/modules/database/index.js';
import { desktopAuthRoutes } from '@/modules/desktop-auth/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { createOrchestratorLocalRouter, createOrchestratorRouter, createOrchestratorService, wakeDisplay, type RunnableProvider } from '@/modules/piecemaker-orchestrateur/index.js';
import { broadcastSessionUpserted, chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import { createBoardRouter, createBoardService, createEtapesRouter, createEtapesService, createSuiviLocalRouter, createSuiviRouter, createSuiviService, createTachesService } from '@/modules/piecemaker-suivi/index.js';
import { providerTokenUsageService, providerModelsService, providerRuntimeService, providerSkillsService, sessionsService } from '@/modules/providers/index.js';
import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { findApplicationRoot, getModuleDirectory, readObjectRecord } from '@/shared/utils.js';


import { createAgentInstructionsRouter, startAgentInstructionsMigration } from './agent-instructions.js';
import { reconcileClaudeHooks, reconcileCodexHooks, reconcileVibeHooks } from './claude-hooks.js';
import { installCustomFiles } from './custom-files.js';
import { startRequiredAnonymizer } from './anonymizer/lifecycle.js';
import { installSessionProxyRuntime } from './anonymizer/session-runtime.js';
import { installCodexPlanRuntime } from './codex-plan.js';
import { installOrchestratorRuntime } from './orchestrator-runtime.js';
import { installCodexEventsRuntime } from './codex-events.js';
import { createProviderLimits, createProviderLimitsRouter } from './provider-limits.js';
import { createHermesRouter } from './hermes/routes.js';
import { installHermesPieceMaker } from './hermes/runtime.js';
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
import { createArtifactFrameRouter, createArtifactsRouter } from './artifacts.js';
import { openArtifacts } from './vendor/mcp/artifacts/artifacts.mjs';
import { readJson } from './library/provider-connectors.js';
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
import { createOrchestratorProviderStatuses } from './orchestrator-providers.js';
import { mistralSdkAuth } from './mistral-sdk/auth.service.js';
import { createMistralHistory, createMistralSdkAuthRouter, createMistralTabularBridge, installMistralSdk, installMistralTokenUsage } from './mistral-sdk/index.js';

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
async function lastSessionAnswer(sessionId: string) {
  const history = await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 });
  return history.messages.filter(message => message.kind === 'text' && message.role === 'assistant' && !message.parentToolUseId).at(-1)?.content ?? '';
}
const taches = createTachesService(piecemakerHome(), {
  open: (tache) => sessionsService.createAppSession(tache.provider as never, tache.projectPath, tache.titre).sessionId,
  run: (tache, sessionId, content) => {
    const preferences = tache.userId === null ? {} : userPreferencesDb.getPreferences(tache.userId);
    const toolsSettings = (preferences[`${tache.provider}Permissions`] ?? { allowedTools: [], disallowedTools: [], skipPermissions: false }) as { skipPermissions?: boolean };
    const turn = runDetachedChatTurn({ sessionId, userId: tache.userId, content, options: { model: tache.model, permissionMode: 'acceptEdits', toolsSettings, skipPermissions: toolsSettings.skipPermissions || false } }, { runtime: providerRuntimeService });
    return tache.type === 'redaction' ? turn.finally(() => library.refresh().catch(() => undefined)) : turn;
  },
  lastAnswer: lastSessionAnswer,
  pending: (sessionId) => providerRuntimeService.getPendingApprovalsForSession(sessionId) as Array<{ requestId: string; toolName: string; input: unknown }>,
  resolve: (requestId, decision) => providerRuntimeService.resolveToolApproval(requestId, decision),
});
function toolPreferences(provider: RunnableProvider, userId: number | null) {
  const preferences = userId === null ? {} : userPreferencesDb.getPreferences(userId);
  return readObjectRecord(preferences[`${provider}Permissions`]) ?? {};
}

function orchestratorTurnOptions(userId: number | null, { provider, permissionMode, allowedTools, disallowedTools }: { provider: RunnableProvider; permissionMode: string; allowedTools: string[]; disallowedTools: string[] }) {
  const preferences = toolPreferences(provider, userId);
  const skipPermissions = permissionMode === 'bypassPermissions' || permissionMode === 'acceptEdits' && preferences.skipPermissions === true;
  return { permissionMode, toolsSettings: { ...preferences, allowedTools, disallowedTools, permissionMode, skipPermissions }, skipPermissions };
}

const providerHistory = sessionsService.fetchHistory.bind(sessionsService);
const providerStatuses = createOrchestratorProviderStatuses(providerAuthService.getProviderAuthStatus, mistralSdkAuth.status);
const providerLimits = createProviderLimits({ connected: providerStatuses });
const orchestrator = createOrchestratorService({
  previousPostIds: async sessionId => {
    const { messages } = await providerHistory(sessionId);
    const calls = new Set(messages.filter(m => m.kind === 'tool_use' && m.toolName === 'mcp__orchestrateur__post_message').map(m => m.toolId).filter(Boolean));
    const ids = new Set<string>();
    for (const row of messages) {
      if (row.kind !== 'tool_result' || !row.toolId || !calls.has(row.toolId) || row.isError) continue;
      const result = JSON.stringify(row.toolResult?.content ?? row.content ?? '');
      for (const id of result.match(/msg_[0-9a-f-]{36}/gi) ?? []) ids.add(id);
    }
    return ids;
  },
  now: () => new Date(),
  contextRatio: async (sessionId, provider) => {
    const usage = await providerTokenUsageService.getSessionTokenUsage(sessionId, true);
    return usage.total && usage.total > 0 ? usage.used / usage.total : null;
  },
  chatChanged: sessionId => { void broadcastSessionUpserted(sessionId, true); },
  changeChatProvider: (sessionId, provider) => {
    getConnection().prepare('UPDATE sessions SET provider = ?, model = NULL WHERE session_id = ?').run(provider, sessionId);
    void broadcastSessionUpserted(sessionId);
  },
  sessionModel: sessionId => sessionsDb.getSessionById(sessionId)?.model ?? null,
  providers: providerStatuses,
  permissions: async (provider, userId) => {
    const { allowedTools, disallowedTools } = toolPreferences(provider, userId);
    return {
      allowedTools: Array.isArray(allowedTools) ? allowedTools.filter(tool => typeof tool === 'string') : [],
      disallowedTools: Array.isArray(disallowedTools) ? disallowedTools.filter(tool => typeof tool === 'string') : [],
    };
  },
  defaultModel: async (provider, purpose) => {
    const catalog = await providerModelsService.getProviderModels(provider);
    if (purpose === 'lookup') {
      const cheap = { claude: /haiku/i, codex: /nano|mini|terra/i, mistral: /small/i }[provider];
      return catalog.OPTIONS.find(model => cheap.test(model.value))?.value ?? catalog.DEFAULT;
    }
    return catalog.DEFAULT;
  },
  models: async provider => (await providerModelsService.getProviderModels(provider)).OPTIONS.map(({ value, label }) => ({ value, label: label ?? value })),
  openSession: (provider, root, title, hidden) => sessionsService.createAppSession(provider, root, title, hidden).sessionId,
  runTurn: async (sessionId, userId, content, options) => {
    const result = await runDetachedChatTurn({
      sessionId, userId, content, displayContent: wakeDisplay(content) ?? undefined,
      options: { ...orchestratorTurnOptions(userId, options), attachments: options.attachments, model: options.model, effort: options.effort, piecemakerOrchestrator: true },
    }, { runtime: providerRuntimeService });
    const complete = chatRunRegistry.getRun(sessionId)?.events.find(event => event.kind === 'complete');
    return result.started && !result.error && complete?.success === false ? { ...result, error: 'Tour interrompu.' } : result;
  },
  lastAnswer: lastSessionAnswer,
  history: async (sessionId, limit) => {
    const history = await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 });
    return history.messages.flatMap(({ kind, role, content, parentToolUseId }) =>
      kind === 'text' && role && typeof content === 'string' && !parentToolUseId ? [{ role, text: content }] : []
    ).slice(-limit);
  },
  wasAborted: sessionId => chatRunRegistry.getRun(sessionId)?.events.some(event => event.kind === 'complete' && event.aborted === true) ?? false,
  isProcessing: sessionId => chatRunRegistry.isProcessing(sessionId),
  abort: async (provider, sessionId) => {
    const run = chatRunRegistry.getRun(sessionId);
    if (run?.status !== 'running') return false;
    const aborted = await providerRuntimeService.abort(provider, sessionId);
    if (aborted) chatRunRegistry.completeRunIfCurrent(run, { exitCode: 0, aborted });
    return aborted;
  },
  pending: sessionId => providerRuntimeService.getPendingApprovalsForSession(sessionId) as Array<{ requestId: string; toolName: string; input: unknown }>,
  resolve: (requestId, allow) => providerRuntimeService.resolveToolApproval(requestId, { allow }),
  notify: (userId, sessionId, title, text) => {
    const provider = sessionId && sessionsDb.getSessionById(sessionId)?.provider;
    const event = createNotificationEvent({ provider: provider || 'system', code: 'agent.notification', meta: { sessionName: title, message: text } });
    notifyUserIfEnabled({ userId, event: { ...event, sessionId } });
  },
  approvedFolders: () => projectsDb.getProjectPaths().map(row => row.project_path),
  artifacts: root => openArtifacts(root).list({ scope: 'mine', limit: 200 }).map(({ url, title, updated_at }: { url: string; title: string; updated_at?: string }) => ({ url, title, updated_at })),
  connectors: root => Object.keys(readObjectRecord(readJson(path.join(root, '.mcp.json')).mcpServers) ?? {}),
});
orchestrator.start();
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
const hermes = installHermesPieceMaker(providerRuntimeService, applicationRoot);
installMistralSdk(providerRegistry.resolveProvider('mistral'), piecemakerHome());
installMistralTokenUsage(providerTokenUsageService, sessionId => sessionsDb.getSessionById(sessionId), createMistralHistory(piecemakerHome()));
installChatCitationHarness({ runtime: providerRuntimeService, sessions: sessionsService, store: citations, ensureProxy, folderHistory, pieceTitle: createPieceTitleResolver(getConnection) });
installLegalCodeHarness({ runtime: providerRuntimeService, sessions: sessionsService, applicationRoot });
const library = await openLibrary(piecemakerHome(), applicationRoot, () => projectsDb.getProjectPaths().map((row) => row.project_path));
installLibrarySkillVisibility(providerSkillsService, library.store);
installLibraryRuntime(providerRuntimeService, sessionsService, library.store);
installOrchestratorRuntime(providerRuntimeService, sessionsService, orchestrator, id => sessionsDb.getSessionById(id)?.project_path ?? null);
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
localRouter.use(createOrchestratorLocalRouter(orchestrator, isLoopback));
localRouter.use(createSuiviLocalRouter(suivi, isLoopback, board));
localRouter.use(createSessionDossierRouter(sessionsDb, isLoopback));
localRouter.use(createOpenPanelRequestsRouter());
localRouter.use(createArtifactFrameRouter());
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
  router.use('/orchestrateur', createOrchestratorRouter(orchestrator, projectsDb));
  router.use('/etapes', createEtapesRouter(etapes, taches));
  router.use('/suivi/board', createBoardRouter(board));
  router.use('/suivi', createSuiviRouter(suivi));
  router.use(createTelegramRouter());
  router.use('/hermes', createHermesRouter(hermes.ensure));
  router.use('/library', library.router);
  router.use(knowledge.router);
  router.use(createCompanySearchRouter());
  router.use(createBodaccSearchRouter());
  router.use(createDocxDocumentRouter());
  router.use(createDocxReviewRouter(projectsDb));
  router.use(createFeatureCommentsRouter(projectsDb));
  router.use(createArtifactsRouter(projectsDb));
  router.use(createFileLinksRouter());
  router.use(createInstitutionalTermsRouter(institutionalTerms));
  router.use(createAgentInstructionsRouter(path.join(piecemakerHome(), 'CLAUDE.md')));
  router.use(createShellEnvironmentRouter(shellEnvironment));
  router.use(createOpenPanelsRouter(piecemakerHome()));
  router.use(remoteRouter);
  router.use(createMistralSdkAuthRouter());
  router.use(createProviderLimitsRouter(providerLimits));
  return router;
}
export type { PieceMakerRuntimeStatus };
export { createExternalFileRouter };
