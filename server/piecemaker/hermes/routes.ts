import express from 'express';

import { readRappels, writeRappels } from './profile.js';

/** Daily deadline reminders sent by Hermes: GET reads the job, POST writes it. */
export function createHermesRouter(ensure: () => Promise<void>) {
  const router = express.Router();
  router.get('/rappels', (_request, response) => {
    response.json(readRappels());
  });
  router.post('/rappels', express.json(), async (request, response) => {
    try {
      const { actif, heure, destination } = request.body ?? {};
      if (typeof actif !== 'boolean') throw new TypeError('actif : true ou false.');
      if (heure !== undefined && typeof heure !== 'string') throw new TypeError('heure : HH:MM attendue.');
      if (destination !== undefined && typeof destination !== 'string') throw new TypeError('destination : texte attendu.');
      await ensure();
      response.json(await writeRappels({ actif, heure, destination }));
    } catch (error) {
      response.status(error instanceof TypeError ? 400 : 500).json({ error: error instanceof Error ? error.message : 'Rappels indisponibles.' });
    }
  });
  return router;
}
