import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { createLibraryStore } from './store.js';
import { createLibraryRouter } from './routes.js';
import { createLibraryMarketplaceRouter, scanInstalledLibraryCollections } from './marketplace.js';
import { scanAndPersistLibraryProviderAgents } from './provider-agents.js';
import { scanAndPersistLibraryProviderConnectors } from './provider-connectors.js';
import { scanAndPersistLibraryProviderSkills } from './provider-skills.js';

export { installLibraryRuntime } from './runtime.js';

const LIBRARY_BODY_LIMIT = 1024 * 1024;

export async function openLibrary(home: string, applicationRoot: string) {
  const store = createLibraryStore(home);
  try { await scanAndPersistLibraryProviderSkills(store, undefined, undefined, os.homedir()); } catch {}
  try { scanAndPersistLibraryProviderAgents(store, os.homedir()); } catch {}
  try { scanAndPersistLibraryProviderConnectors(store, os.homedir()); } catch {}
  try { scanInstalledLibraryCollections(store, os.homedir()); } catch {}
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
  router.use(createLibraryMarketplaceRouter(store, applicationRoot, os.homedir()));
  return { store, router };
}
