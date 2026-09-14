import express from 'express';

import type { createLibraryStore } from './store.js';
import { listLibraryProviderSkills, scanAndPersistLibraryProviderSkills } from './provider-skills.js';

export function createLibraryRouter(store: ReturnType<typeof createLibraryStore>) {
  const router = express.Router();
  router.get('/catalog', (req, res) => {
    try { res.json({ entries: store.list(typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined) }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/catalog', (req, res) => {
    const kind = req.body?.kind;
    const name = req.body?.name;
    if (kind !== 'skill' && kind !== 'agent') { res.status(400).json({ error: 'Type invalide.' }); return; }
    if (typeof name !== 'string' || !name.trim()) { res.status(400).json({ error: 'Nom requis.' }); return; }
    const description = typeof req.body?.description === 'string' ? req.body.description : '';
    try { res.json(store.createEntry(kind, name, description)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/provider-skills', async (req, res) => {
    const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined;
    res.json(await listLibraryProviderSkills(workspacePath));
  });
  router.post('/provider-skills/scan', async (req, res) => {
    const workspacePath = typeof req.body?.workspacePath === 'string' ? req.body.workspacePath : undefined;
    try { res.json(await scanAndPersistLibraryProviderSkills(store, workspacePath)); }
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
  router.delete('/catalog/:id', (req, res) => {
    try { res.json(store.deleteEntry(String(req.params.id))); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.put('/catalog/:id/activation', (req, res) => {
    try { res.json(store.setEnabled(req.body?.workspacePath, String(req.params.id), req.body?.enabled)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  return router;
}
