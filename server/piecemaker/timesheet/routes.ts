import express from 'express';

import { parseTimesheetQuery } from './service.js';
import type { createTimesheetService } from './service.js';

type TimesheetService = ReturnType<typeof createTimesheetService>;

function errorResponse(error: unknown): { status: number; body: { error: string; code?: string } } {
  if (error && typeof error === 'object' && 'statusCode' in error && 'message' in error) {
    const statusCode = Number(error.statusCode);
    if (statusCode >= 400 && statusCode < 500) {
      return {
        status: statusCode,
        body: {
          error: String(error.message),
          code: 'code' in error ? String(error.code) : undefined,
        },
      };
    }
  }
  return { status: 500, body: { error: 'Timesheet operation failed.' } };
}

export function createTimesheetRouter(service: TimesheetService) {
  const router = express.Router();

  router.get('/timesheet/entries', (request, response) => {
    try {
      const query = parseTimesheetQuery({ scope: request.query.scope, projectId: request.query.projectId });
      response.json({ entries: service.list(query) });
    } catch (error) {
      const result = errorResponse(error);
      response.status(result.status).json(result.body);
    }
  });

  router.post('/timesheet/refresh', async (request, response) => {
    try {
      const query = parseTimesheetQuery({ scope: request.body?.scope, projectId: request.body?.projectId });
      response.json(await service.refresh(query));
    } catch (error) {
      const result = errorResponse(error);
      response.status(result.status).json(result.body);
    }
  });

  return router;
}
