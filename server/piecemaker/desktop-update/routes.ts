import express from 'express';

import type { createDesktopUpdateService } from './service.js';

type DesktopUpdateService = ReturnType<typeof createDesktopUpdateService>;

export function createDesktopUpdateRouter(service: DesktopUpdateService): express.Router {
  const router = express.Router();
  let pendingUpdate: ReturnType<DesktopUpdateService['update']> | null = null;

  router.post('/update', async (_request, response, next) => {
    if (!service.isDesktopInstall()) {
      next();
      return;
    }

    try {
      pendingUpdate ??= service.update().finally(() => {
        pendingUpdate = null;
      });
      const result = await pendingUpdate;
      response.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
