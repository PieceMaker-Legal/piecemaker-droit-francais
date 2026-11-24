import express from 'express';
import type { Request, Response } from 'express';

import { brainDossiers, generateLibrary } from './generate.js';
import { linkProject, readConcept, readLibrary, writeConcept } from './read.js';
import { openSource } from './source.js';
import type { Git } from './source.js';

type LibraryOptions = { home: string; brainRoot: () => string; git?: Git };

/**
 * Library de l'agent central : le clone local de Legal-OKF (`<brain>/Library`), complété à chaque
 * lecture par les bundles générés `clients/` et `projects/`. Monté sous `/api/piecemaker/legal-okf`.
 */
export function createLegalOkfRouter({ home, brainRoot, git }: LibraryOptions) {
  const source = openSource({ home, brainRoot, git });
  const router = express.Router();
  let cloning: Promise<unknown> | null = null;

  const send = (response: Response, run: () => unknown) => {
    Promise.resolve().then(run).then((value) => response.json(value)).catch((error: Error & { code?: unknown }) => {
      response.status(typeof error.code === 'number' ? error.code : 500).json({ error: error.message });
    });
  };

  const snapshot = () => {
    const bundle = source.bundle();
    const generated = generateLibrary(bundle, brainDossiers(brainRoot()));
    return { ...source.config(), path: source.clone(), present: source.present(), generated, ...readLibrary(bundle) };
  };

  router.get('/', (_request, response) => send(response, async () => {
    // Premier affichage sans clone : une seule tentative par démarrage du serveur.
    if (!source.present() && !cloning) cloning = source.sync().catch((error: Error) => ({ error: error.message }));
    const attempt = !source.present() && cloning ? await cloning : null;
    return { ...snapshot(), syncError: attempt && typeof attempt === 'object' && 'error' in attempt ? attempt.error : null };
  }));
  router.post('/sync', (_request, response) => send(response, async () => { await source.sync(); return snapshot(); }));
  router.get('/concept', (request: Request, response) => send(response, () => readConcept(source.bundle(), request.query.id)));
  router.put('/concept', (request: Request, response) => send(response, () => writeConcept(source.bundle(), request.body?.id, request.body?.content)));
  router.put('/link', (request: Request, response) => send(response, () => {
    linkProject(source.bundle(), request.body?.project, request.body?.target, request.body?.attach !== false);
    return snapshot();
  }));
  return router;
}
