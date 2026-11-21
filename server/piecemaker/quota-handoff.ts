import express from 'express';
import type { Request, Response } from 'express';

import { detectQuotaLimit } from '../../shared/piecemaker/quota-limit.js';

export const HANDOFF_PROVIDERS = ['claude', 'codex', 'mistral', 'cursor', 'opencode', 'hermes'] as const;
type HandoffProvider = typeof HANDOFF_PROVIDERS[number];

type HistoryEntry = { role: 'user' | 'assistant'; text: string };

export type QuotaHandoffDependencies = {
  source(sessionId: string): { provider: string; projectPath: string } | null;
  history(sessionId: string): Promise<HistoryEntry[]>;
  openSession(provider: HandoffProvider, projectPath: string, title: string): string;
  runTurn(input: { sessionId: string; userId: number | null; content: string; displayContent: string; provider: HandoffProvider; model: string; permissionMode: string }): Promise<{ started: boolean; error: string | null }>;
  announce(sessionId: string): void;
};

const HISTORY_TURNS = 12;
const TURN_CHARACTERS = 4_000;
const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', mistral: 'Mistral', cursor: 'Cursor', opencode: 'OpenCode', hermes: 'Hermes' };

const clip = (text: string) => (text.length > TURN_CHARACTERS ? `${text.slice(0, TURN_CHARACTERS)} […]` : text);

export function buildHandoffPrompt(previousProvider: string, history: HistoryEntry[]): string {
  const turns = history
    .filter((entry) => entry.text.trim() && !detectQuotaLimit(entry.text))
    .slice(-HISTORY_TURNS)
    .map((entry) => `[${entry.role === 'user' ? 'Avocat' : 'Assistant'}]\n${clip(entry.text.trim())}`);
  const name = PROVIDER_NAMES[previousProvider] ?? previousProvider;
  return [
    `La session précédente, menée avec ${name}, s'est arrêtée : sa limite d'utilisation est atteinte. Tu reprends le travail dans le même dossier.`,
    turns.length ? `Fin de la conversation précédente :\n\n<conversation-precedente>\n${turns.join('\n\n')}\n</conversation-precedente>` : 'La conversation précédente ne contient aucun échange lisible.',
    "Continue la tâche en cours là où elle s'est arrêtée, sans refaire ce qui est déjà fait. Vérifie l'état des fichiers du dossier avant de les modifier.",
  ].join('\n\n');
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createQuotaHandoffRouter(dependencies: QuotaHandoffDependencies) {
  const router = express.Router();
  router.use(express.json());

  router.post('/quota/handoff', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const sourceId = readText(body.sessionId);
    const provider = readText(body.provider) as HandoffProvider;
    const model = readText(body.model);
    const permissionMode = readText(body.permissionMode) || 'default';
    if (!sourceId || !HANDOFF_PROVIDERS.includes(provider) || !model) {
      response.status(400).json({ error: 'sessionId, provider et model sont requis.' });
      return;
    }
    const source = dependencies.source(sourceId);
    if (!source) {
      response.status(404).json({ error: 'Session introuvable.' });
      return;
    }
    try {
      const content = buildHandoffPrompt(source.provider, await dependencies.history(sourceId));
      const displayContent = `Reprise du travail de la session précédente (${PROVIDER_NAMES[source.provider] ?? source.provider}, limite atteinte).`;
      const sessionId = dependencies.openSession(provider, source.projectPath, displayContent);
      dependencies.announce(sessionId);
      const userId = Number((request as Request & { user?: { id?: unknown } }).user?.id);
      const result = await dependencies.runTurn({ sessionId, userId: Number.isInteger(userId) ? userId : null, content, displayContent, provider, model, permissionMode });
      if (!result.started) {
        response.status(409).json({ error: result.error ?? 'Le tour n’a pas démarré.', sessionId });
        return;
      }
      response.json({ sessionId });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
