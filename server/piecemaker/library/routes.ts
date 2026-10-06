import os from 'node:os';

import express from 'express';

import { parseFrontMatter } from '@/shared/frontmatter.js';

import type { createLibraryStore } from './store.js';
import { globalProviderIndex } from './global-state.js';
import { applyWorkspaceSkillVisibility, personalClaudeSkills } from './skill-visibility.js';

function shadowingPersonalSkills(store: ReturnType<typeof createLibraryStore>, entries: Array<{ id: string; kind: string; name: string; enabled: boolean }>, userHome: string) {
  const shadows = new Map<string, string>();
  const enabled = entries.filter((entry) => entry.enabled && entry.kind === 'skill');
  if (!enabled.length) return shadows;
  const personal = personalClaudeSkills(userHome);
  const contents = store.contents(enabled.map((entry) => entry.id));
  for (const entry of enabled) {
    try {
      const content = contents.get(entry.id) ?? '';
      const names = [entry.name, String(parseFrontMatter(content).data.name || '')].map((name) => name.trim().toLowerCase());
      const shadow = personal.find((skill) => names.includes(skill.name.toLowerCase()) && skill.content !== content);
      if (shadow) shadows.set(entry.id, shadow.file);
    } catch {}
  }
  return shadows;
}

export function createLibraryRouter(store: ReturnType<typeof createLibraryStore>, userHome = os.homedir()) {
  const router = express.Router();
  router.get('/catalog', (req, res) => {
    try {
      const globalProviders = globalProviderIndex(userHome);
      const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined;
      const entries = store.list(workspacePath);
      const shadows = workspacePath ? shadowingPersonalSkills(store, entries, userHome) : new Map<string, string>();
      res.json({ entries: entries.map(({ sources, ...entry }) => ({ ...entry, globalProviders: globalProviders(sources), ...(shadows.has(entry.id) ? { shadowedBy: shadows.get(entry.id) } : {}) })) });
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
      const workspaces = store.deactivatedWorkspaces(id);
      const result = store.deleteEntry(id);
      for (const workspace of workspaces) applyWorkspaceSkillVisibility(store, workspace);
      res.json(result);
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
