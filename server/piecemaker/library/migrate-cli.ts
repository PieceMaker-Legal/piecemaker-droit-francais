import os from 'node:os';
import path from 'node:path';

import { createLibraryStore } from './store.js';
import { migratePersonalLibrary } from './migrate.js';
import type { LibraryScanError } from './scan-errors.js';

const store = createLibraryStore(process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'));
try {
  const errors: LibraryScanError[] = [];
  const imported = migratePersonalLibrary(store, os.homedir(), process.cwd(), errors);
  process.stdout.write(`${JSON.stringify({ imported: imported.map(({ id, source }) => ({ id, source })), errors, catalog: store.list() }, null, 2)}\n`);
} finally { store.close(); }
