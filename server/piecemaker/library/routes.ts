import os from 'node:os';

import express from 'express';

import { parseFrontMatter } from '@/shared/frontmatter.js';

import type { createLibraryStore } from './store.js';
import { applyWorkspaceSkillVisibility, personalClaudeSkills } from './skill-visibility.js';

export function createLibraryRouter(store: ReturnType<typeof createLibraryStore>, userHome: string = os.homedir()) {
  const router = express.Router();
  router.get('/catalog', (req, res) => {
    try {
      const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined;
      const entries: Array<ReturnType<typeof store.list>[number] & { shadowedBy?: string }> = store.list(workspacePath);
      if (workspacePath && entries.some((entry) => entry.enabled && entry.kind === 'skill')) {
        const personal = personalClaudeSkills(userHome);
        const contents = store.contents(entries.filter((entry) => entry.enabled && entry.kind === 'skill').map((entry) => entry.id));
        for (const entry of entries) {
          if (!entry.enabled || entry.kind !== 'skill') continue;
          try {
            const content = contents.get(entry.id) ?? '';
            const names = [entry.name, String(parseFrontMatter(content).data.name || '')].map((name) => name.trim().toLowerCase());
            const shadow = personal.find((skill) => names.includes(skill.name.toLowerCase()) && skill.content !== content);
            if (shadow) entry.shadowedBy = shadow.file;
          } catch { /* avertissement facultatif */ }
        }
      }
      res.json({ entries });
    }
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
    try {
      const id = String(req.params.id);
      const workspaces = store.activeWorkspaces(id);
      const result = store.deleteEntry(id);
      const visibility = workspaces.map((workspace) => applyWorkspaceSkillVisibility(store, workspace));
      res.json({ ...result, visibility });
    }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.put('/catalog/:id/activation', (req, res) => {
    try {
      const result = store.setEnabled(req.body?.workspacePath, String(req.params.id), req.body?.enabled);
      res.json({ ...result, visibility: applyWorkspaceSkillVisibility(store, req.body.workspacePath) });
    }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  return router;
}
