import os from 'node:os';
import path from 'node:path';

import { createLibraryStore } from './store.js';
import { migratePersonalLibrary } from './migrate.js';

const store = createLibraryStore(process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'));
try {
  const imported = migratePersonalLibrary(store, os.homedir(), process.cwd(), process.argv.includes('--withdraw'));
  process.stdout.write(`${JSON.stringify({ imported: imported.map(({ id, source }) => ({ id, source })), catalog: store.list() }, null, 2)}\n`);
} finally { store.close(); }
