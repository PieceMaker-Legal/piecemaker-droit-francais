import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import express from 'express';

import { createLibraryStore } from './store.js';
import { createLibraryRouter } from './routes.js';
import { createLibraryMarketplaceRouter } from './marketplace.js';

export { installLibraryRuntime } from './runtime.js';

export async function startLibraryBackend(home: string, applicationRoot: string) {
  const store = createLibraryStore(home);
  const require = createRequire(import.meta.url);
  const { createActivationRouter } = require(path.join(applicationRoot, 'server/piecemaker/activation/index.cjs'));
  const options = { repoRoot: path.join(applicationRoot, 'server/piecemaker/vendor'), piecemakerHome: home, homeDir: home, userHome: os.homedir(), isOriginAllowed: () => true };
  const token = randomBytes(32).toString('hex');
  const app = express();
  app.use((req, res, next) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.sendStatus(401); return; }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(createLibraryRouter(store));
  app.use(createLibraryMarketplaceRouter(store, applicationRoot, os.homedir()));
  app.use((req, res, next) => {
    if ((req.method === 'GET' && req.path === '/activation')
      || (req.method === 'POST' && req.path === '/activation/toggle')) { next(); return; }
    res.sendStatus(404);
  });
  app.use(createActivationRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Bibliothèque indisponible.');
  const connection = path.join(store.directory, 'connection.json');
  const temporary = `${connection}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ port: address.port, token }), { mode: 0o600 });
  fs.renameSync(temporary, connection);
  server.unref();
  process.once('exit', () => {
    try {
      if (JSON.parse(fs.readFileSync(connection, 'utf8')).token === token) fs.unlinkSync(connection);
    } catch {}
  });
  return store;
}
