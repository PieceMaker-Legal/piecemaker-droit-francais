import { createHmac, timingSafeEqual } from 'node:crypto';

import express from 'express';

import type { createDesktopAuthService } from './desktop-auth.service.js';

export function createDesktopAuthRouter(service: ReturnType<typeof createDesktopAuthService>, secret: string | undefined) {
  const router = express.Router();
  router.use('/desktop-auth', (request, response, next) => {
    const supplied = request.headers['x-piecemaker-desktop-auth'];
    const valid = secret && typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(secret)
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
    const identity = request.method === 'GET' && request.path === '/identity';
    if (!secret || (!valid && !identity) || request.headers.origin || Object.keys(request.headers).some(name => /^(?:forwarded$|x-forwarded-|tailscale-|x-piecemaker-remote$)/.test(name))
      || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress || '')) {
      response.status(403).json({ error: 'Action réservée à l’application de bureau.' });
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/desktop-auth/identity', (request, response) => {
    const challenge = request.query.challenge;
    if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge)) {
      response.status(400).end();
      return;
    }
    response.json({ proof: createHmac('sha256', secret!).update(challenge).digest('hex') });
  });
  router.get('/desktop-auth/account', (_request, response) => {
    const user = service.account();
    response.json(user ? { username: user.username } : { username: null });
  });
  router.post('/desktop-auth/reset', async (request, response) => {
    try {
      response.json(await service.reset(request.body?.password));
    } catch (error) {
      response.status(error instanceof TypeError ? 400 : 409).json({ error: error instanceof Error ? error.message : 'Réinitialisation impossible.' });
    }
  });
  return router;
}
