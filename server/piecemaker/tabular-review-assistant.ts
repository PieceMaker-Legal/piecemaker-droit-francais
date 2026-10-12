import express from 'express';

import { getPluginPort } from '@/modules/plugins/index.js';
import { getPluginsConfig } from '@/modules/plugins/plugin-registry.service.js';

import { isLoopback } from './knowledge/local-routes.js';

const PLUGIN = 'piecemaker-tabular-review';

export type TabularReviewAssistantOptions = {
  proxyOrigin(): string | null;
  pluginPort?(): number | null;
  pluginSecrets?(): Record<string, unknown>;
};

export function createTabularReviewLocalRouter(options: TabularReviewAssistantOptions) {
  const pluginPort = options.pluginPort ?? (() => getPluginPort(PLUGIN));
  const pluginSecrets = options.pluginSecrets ?? (() => (getPluginsConfig()[PLUGIN]?.secrets ?? {}) as Record<string, unknown>);
  const router = express.Router();

  router.post('/tabular-review', async (request, response) => {
    if (!isLoopback(request)) {
      response.status(403).json({ erreur: 'Accès réservé à la boucle locale.' });
      return;
    }
    const port = pluginPort();
    if (!port) {
      response.status(503).json({ erreur: 'Tabular Review indisponible : activez le plugin « Analyse Tabulaire » dans PieceMaker.' });
      return;
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    for (const [key, value] of Object.entries(pluginSecrets())) headers[`x-plugin-secret-${key.toLowerCase()}`] = String(value);
    try {
      const reply = await fetch(`http://127.0.0.1:${port}/assistant`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request.body, proxyOrigin: options.proxyOrigin() }),
      });
      const payload = await reply.json() as { error?: string };
      if (!reply.ok || payload?.error) {
        response.status(400).json({ erreur: payload?.error ?? `Tabular Review : erreur ${reply.status}` });
        return;
      }
      response.json({ resultat: payload });
    } catch (error) {
      response.status(502).json({ erreur: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
