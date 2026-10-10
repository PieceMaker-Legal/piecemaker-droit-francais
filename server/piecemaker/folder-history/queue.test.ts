import assert from 'node:assert/strict';
import test from 'node:test';

import { createGitQueue } from './queue.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('file globale : une seule tâche à la fois, dans l’ordre', async () => {
  const queue = createGitQueue();
  let running = 0;
  let maxRunning = 0;
  const order: string[] = [];
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    queue.push(name, async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await pause(5);
      order.push(name);
      running -= 1;
    });
  }
  await queue.idle();
  assert.equal(maxRunning, 1);
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e']);
});

test('file globale : une tâche déjà en attente n’est pas ajoutée deux fois, une erreur n’arrête pas la file', async () => {
  const queue = createGitQueue();
  const done: string[] = [];
  queue.push('bloquante', async () => { await pause(5); throw new Error('échec simulé'); });
  queue.push('manuelle', async () => { done.push('manuelle'); });
  queue.push('manuelle', async () => { done.push('doublon'); });
  await queue.idle();
  assert.deepEqual(done, ['manuelle']);
});
