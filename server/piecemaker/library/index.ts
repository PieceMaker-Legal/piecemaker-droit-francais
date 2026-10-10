import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { providerSkillsService } from '@/modules/providers/index.js';

import { createLibraryStore } from './store.js';
import { createLibraryRouter } from './routes.js';
import { createLibraryMarketplaceRouter, scanLibrarySources } from './marketplace.js';

export { installLibraryRuntime } from './runtime.js';
export { installLibrarySkillVisibility } from './skill-visibility.js';

const LIBRARY_BODY_LIMIT = 1024 * 1024;

export async function openLibrary(home: string, applicationRoot: string, listProjectPaths: () => string[] = () => []) {
  const store = createLibraryStore(home);
  const reader = { listProviderSkills: providerSkillsService.listProviderSkills.bind(providerSkillsService) };
  const errors = await scanLibrarySources(store, os.homedir(), listProjectPaths, reader);
  if (errors.length) console.warn(`Bibliothèque : ${errors.length} élément(s) non importé(s) (${errors.slice(0, 3).map((error) => error.source).join(', ')}${errors.length > 3 ? ', …' : ''})`);
  try { fs.unlinkSync(path.join(store.directory, 'connection.json')); } catch {}
  const router = express.Router();
  router.use((req, res, next) => {
    const length = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(length) && length > LIBRARY_BODY_LIMIT) {
      res.status(413).json({ error: 'Requête trop volumineuse.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(createLibraryRouter(store));
  router.use(createLibraryMarketplaceRouter(store, applicationRoot, os.homedir(), listProjectPaths, reader));
  return { store, router };
}
