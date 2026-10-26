import express from 'express';

import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { mistralSdkAuth } from './auth.service.js';

export function createMistralSdkAuthRouter(service = mistralSdkAuth) {
  const router = express.Router();
  const userId = (request: express.Request) => {
    const id = Number((request as express.Request & { user?: { id?: number } }).user?.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('Authentification PieceMaker requise.', { statusCode: 401, code: 'UNAUTHORIZED' });
    return id;
  };
  router.get('/mistral-sdk/auth', asyncHandler(async (request, response) => {
    response.json(service.status(userId(request)));
  }));
  router.get('/mistral-sdk/provider-status', asyncHandler(async (request, response) => {
    const status = service.status(userId(request));
    response.json(createApiSuccessResponse({
      provider: 'mistral', installed: true, authenticated: status.authenticated,
      email: null, method: 'browser', error: status.error,
    }));
  }));
  router.post('/mistral-sdk/auth/login', asyncHandler(async (request, response) => {
    response.json({ url: await service.startLogin(userId(request)) });
  }));
  router.post('/mistral-sdk/auth/logout', asyncHandler(async (request, response) => {
    response.json(service.logout(userId(request)));
  }));
  router.post('/mistral-sdk/auth/check', asyncHandler(async (request, response) => {
    response.json(await service.checkConnection(userId(request)));
  }));
  return router;
}
