import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { createLibraryStore } from './store.js';
import { createLibraryRouter } from './routes.js';
import { createLibraryMarketplaceRouter, scanInstalledLibraryCollections } from './marketplace.js';
import { scanAndPersistLibraryProviderAgents } from './provider-agents.js';
import { scanAndPersistLibraryProviderConnectors } from './provider-connectors.js';
import { scanAndPersistLibraryProjectSkills, scanAndPersistLibraryProviderSkills } from './provider-skills.js';
import { recordScanError, type LibraryScanError } from './scan-errors.js';

export { installLibraryRuntime } from './runtime.js';

const LIBRARY_BODY_LIMIT = 1024 * 1024;

export async function openLibrary(home: string, applicationRoot: string, listProjectPaths: () => string[] = () => []) {
  const store = createLibraryStore(home);
  const errors: LibraryScanError[] = [];
  try { await scanAndPersistLibraryProviderSkills(store, undefined, undefined, os.homedir(), errors); } catch {}
  try { await scanAndPersistLibraryProjectSkills(store, listProjectPaths(), undefined, errors); } catch (error) { recordScanError(errors, 'projets', error); }
  try { scanAndPersistLibraryProviderAgents(store, os.homedir(), errors); } catch {}
  try { scanAndPersistLibraryProviderConnectors(store, os.homedir(), errors); } catch {}
  try { scanInstalledLibraryCollections(store, os.homedir(), errors); } catch {}
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
  router.use(createLibraryRouter(store, os.homedir()));
  router.use(createLibraryMarketplaceRouter(store, applicationRoot, os.homedir(), listProjectPaths));
  return { store, router };
}
