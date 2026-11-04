import express from 'express';

export function createTelegramRouter() {
  const router = express.Router();
  router.get('/telegram', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const upstream = await fetch('http://127.0.0.1:8769/connection', { signal: AbortSignal.timeout(5000) });
      if (!upstream.ok) throw new Error();
      const state = await upstream.json() as Record<string, unknown>;
      if (state.available !== true || typeof state.username !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(state.username) || typeof state.qr !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(state.qr)) throw new Error();
      response.json({ available: true, name: 'PieceMaker', username: state.username, url: `https://t.me/${state.username}?start=suivi`, qr: state.qr, skill: state.skill === true });
    } catch {
      response.status(503).json({ available: false, error: 'La connexion Telegram est indisponible. Démarrez le bot et la mini-app, puis réessayez.' });
    }
  });
  return router;
}
