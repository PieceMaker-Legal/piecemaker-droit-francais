import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTachesService, type TacheInput } from '../taches.js';

test('la file automatique attend les tours actifs et reprend après une question, le lancement manuel reste parallèle', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-taches-'));
  const lancements: string[] = [];
  const fins = new Map<string, (value: { started: boolean; error: null }) => void>();
  const taches = createTachesService(home, {
    open: (tache) => tache.id,
    run: (tache) => {
      lancements.push(tache.titre);
      return new Promise((resolve) => fins.set(tache.id, resolve));
    },
    lastAnswer: async () => 'Question : Quelle date retenir ?',
    pending: () => [],
    resolve: () => undefined,
  });
  context.after(() => taches.stop());
  const ajouter = (titre: string, auto = true) => taches.add({ projectPath: home, dossier: 'Dossier fictif', raisonnement: null, type: 'index', titre, provider: 'codex', model: 'modele-fictif', prompt: 'Vérifier', auto, userId: null } satisfies TacheInput);
  const premier = ajouter('Premier');
  ajouter('Second');
  const manuel = ajouter('Manuel', false);
  context.mock.timers.tick(3000);
  assert.deepEqual(lancements, ['Premier']);
  context.mock.timers.tick(6000);
  assert.deepEqual(lancements, ['Premier']);
  taches.launch(manuel.id);
  assert.deepEqual(lancements, ['Premier', 'Manuel']);
  fins.get(premier.id)!({ started: true, error: null });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(taches.list().find((entry) => entry.id === premier.id)?.statut, 'question');
  context.mock.timers.tick(3000);
  assert.deepEqual(lancements, ['Premier', 'Manuel']);
  fins.get(manuel.id)!({ started: true, error: null });
  await new Promise<void>((resolve) => setImmediate(resolve));
  context.mock.timers.tick(3000);
  assert.deepEqual(lancements, ['Premier', 'Manuel', 'Second']);
});
