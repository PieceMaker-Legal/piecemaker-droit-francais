const express = require('express');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createMikeService } = require('./service.cjs');

function createMikeRouter(options) {
  const router = express.Router();
  const service = createMikeService(options);
  router.get('/mike/status', async (_request, response) => response.json(await service.status()));
  router.get('/mike/documents/:documentId/download', async (request, response) => {
    try {
      const result = await service.downloadDocument(request.user.id, request.params.documentId);
      response.set('Content-Type', result.response.headers.get('content-type') || 'application/octet-stream');
      response.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
      await pipeline(Readable.fromWeb(result.response.body), response);
    } catch {
      if (!response.headersSent) response.status(503).json({ error: 'Le document Mike est indisponible.' });
      else response.destroy();
    }
  });
  router.get('/mike/workflows', async (request, response) => {
    try { response.json(await service.workflows(request.user.id)); }
    catch { response.status(503).json({ error: 'Les workflows Mike sont indisponibles.' }); }
  });
  router.get('/mike/workflows/:workflowId', async (request, response) => {
    try { response.json(await service.workflows(request.user.id, request.params.workflowId)); }
    catch { response.status(503).json({ error: 'Le workflow Mike est indisponible.' }); }
  });
  router.get('/mike/quick-actions', async (request, response) => {
    try { response.json(await service.quickActions(request.user.id)); }
    catch { response.status(503).json({ error: 'Les actions rapides Mike sont indisponibles.' }); }
  });
  router.post('/mike/open', async (request, response) => {
    try {
      const origin = request.get('origin') || `${request.protocol}://${request.get('host')}`;
      const result = await service.open(request.user.id, request.body?.path, origin);
      response.append('Set-Cookie', result.cookie);
      response.json({ url: result.url });
    } catch (error) {
      console.error('[PieceMaker Mike] Ouverture impossible.', error.message);
      response.status(503).json({ error: 'L’espace Mike est en cours de préparation ou indisponible. Réessayez dans quelques instants.' });
    }
  });
  router.post('/mike/close', (request, response) => {
    service.close(request.user.id);
    response.append('Set-Cookie', 'pm_mike_gate=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    response.status(204).end();
  });
  return router;
}

module.exports = { createMikeRouter };
