import { existsSync } from 'node:fs';
import path from 'node:path';

import { getApplicationDataRoot } from '@/shared/utils.js';

import { startGateway } from './gateway.js';
import { createKeepAwake } from './keep-awake.js';
import { createKeepAwakeRouter } from './keep-awake-router.js';
import { createRemoteAccess, createRemoteRouter } from './remote-access.js';
import { createTailscale } from './tailscale.js';

export function startRemoteAccess(applicationRoot: string) {
  const keepAwake = createKeepAwake();
  const remote = createRemoteAccess({
    tailscale: createTailscale(),
    dataRoot: getApplicationDataRoot(),
    devMode: !existsSync(path.join(applicationRoot, 'dist', 'index.html')),
    serverPort: Number.parseInt(process.env.SERVER_PORT || '3001', 10),
    vitePort: Number.parseInt(process.env.VITE_PORT || '5173', 10),
    keepAwake,
    startGateway,
  });
  void remote.resume();
  const router = createRemoteRouter(remote);
  router.use(createKeepAwakeRouter(keepAwake));
  return router;
}
