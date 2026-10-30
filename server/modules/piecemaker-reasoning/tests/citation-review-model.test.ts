import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCitationReviewer } from '../citation-review-model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const input = { cwd: '/dossier-fictif', affirmations: [{ emplacement: 'fait.true[0]', type: 'fondement' as const, affirmation: 'Le fait est vrai.', citations: [{ source: 'piece.md', citation: 'Le fait est présent.' }] }], sources: [{ source: 'piece.md', texte: 'Le fait est présent.' }], contexte: {}, online: true };
const result = { verifications: [{ emplacement: 'fait.true[0]', reponse: 'validé', score: 4, explication: 'Le passage correspond.' }] };

test('le fournisseur sélectionné reçoit son modèle small, sans réutiliser le cache d’un autre compte ou fournisseur', async () => {
  let selection = { provider: 'mistral', userId: 1 };
  const observed: Array<{ provider: string; model: string; userId: number }> = [];
  const review = createCitationReviewer(root, () => selection, async (request) => {
    observed.push({ provider: request.provider, model: request.model, userId: request.userId });
    const { online: _online, ...payload } = input;
    assert.deepEqual(JSON.parse(request.payload), { ...payload, contexte: JSON.parse(request.payload).contexte });
    assert.deepEqual(request.schema.properties.verifications.items.properties.reponse.enum, ['validé', 'non validé', 'indéterminé']);
    return result;
  });
  await review(input);
  await review(input);
  await review({ ...input, online: false });
  assert.equal(observed.length, 1);
  selection = { provider: 'claude', userId: 1 };
  await assert.rejects(review({ ...input, online: false }), /hors ligne/);
  await review(input);
  selection = { provider: 'codex', userId: 1 };
  await review(input);
  selection = { provider: 'codex', userId: 2 };
  await review(input);
  assert.deepEqual(observed, [
    { provider: 'mistral', model: 'mistral-small-latest', userId: 1 },
    { provider: 'claude', model: 'haiku', userId: 1 },
    { provider: 'codex', model: 'gpt-6-luna', userId: 1 },
    { provider: 'codex', model: 'gpt-6-luna', userId: 2 },
  ]);
  await review({ ...input, contexte: { changement: true } });
  assert.equal(observed.length, 5);
});

test('un fournisseur non pris en charge ne déclenche aucun autre fournisseur', async () => {
  let invoked = false;
  const review = createCitationReviewer(root, () => ({ provider: 'cursor', userId: 1 }), async () => { invoked = true; return result; });
  await assert.rejects(review(input), /Claude, Codex ou Mistral/);
  assert.equal(invoked, false);
});

test('une réponse invalide ou un échec ne devient pas une validation en cache', async () => {
  let calls = 0;
  const review = createCitationReviewer(root, () => ({ provider: 'codex', userId: 1 }), async () => {
    calls += 1;
    if (calls === 1) throw new Error('Indisponible');
    if (calls === 2) return { verifications: [] };
    return result;
  });
  await assert.rejects(review(input), /Indisponible/);
  await assert.rejects(review({ ...input, online: false }), /hors ligne/);
  await assert.rejects(review(input), /toutes les affirmations/);
  await review(input);
  await review(input);
  assert.equal(calls, 3);
});
