import express from 'express';

import type { createLibraryStore } from './store.js';

export function createLibraryRouter(store: ReturnType<typeof createLibraryStore>) {
  const router = express.Router();
  router.get('/catalog', (req, res) => {
    try { res.json({ entries: store.list(typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined) }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/catalog/:id', (req, res) => {
    try { res.json(store.document(String(req.params.id))); }
    catch (error) { res.status(404).json({ error: (error as Error).message }); }
  });
  router.put('/catalog/:id', (req, res) => {
    if (typeof req.body?.content !== 'string' || typeof req.body?.previousContent !== 'string') {
      res.status(400).json({ error: 'Contenu et version précédente requis.' });
      return;
    }
    try { res.json(store.updateDocument(String(req.params.id), req.body.content, req.body.previousContent)); }
    catch (error) { res.status(409).json({ error: (error as Error).message }); }
  });
  router.put('/catalog/:id/activation', (req, res) => {
    try { res.json(store.setEnabled(req.body?.workspacePath, String(req.params.id), req.body?.enabled)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  return router;
}
