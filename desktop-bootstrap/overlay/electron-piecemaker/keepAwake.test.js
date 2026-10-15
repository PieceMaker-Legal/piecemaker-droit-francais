import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { installDesktopKeepAwake } from './keepAwake.js';

function fakePowerSaveBlocker() {
  const started = new Set();
  const types = [];
  let next = 1;
  return {
    start: (type) => {
      const id = next++;
      started.add(id);
      types.push(type);
      return id;
    },
    stop: (id) => started.delete(id),
    isStarted: (id) => started.has(id),
    started,
    types,
  };
}

test('l’app de bureau pose et relâche powerSaveBlocker', async () => {
  const previous = process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL;
  const app = new EventEmitter();
  const powerSaveBlocker = fakePowerSaveBlocker();
  try {
    delete process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL;
    await installDesktopKeepAwake({ app, powerSaveBlocker });
    const url = process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL;
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]{36}$/i);
    const post = (enabled) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
    assert.deepEqual(await (await fetch(url)).json(), { active: false });
    assert.deepEqual(await (await post(true)).json(), { active: true });
    assert.equal(powerSaveBlocker.started.size, 1);
    assert.deepEqual(powerSaveBlocker.types, ['prevent-app-suspension']);
    assert.deepEqual(await (await post(true)).json(), { active: true });
    assert.equal(powerSaveBlocker.started.size, 1);
    assert.deepEqual(await (await post(false)).json(), { active: false });
    assert.equal(powerSaveBlocker.started.size, 0);
    assert.equal((await fetch(url + '/nope')).status, 404);
    app.emit('quit');
  } finally {
    if (previous === undefined) delete process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL;
    else process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL = previous;
  }
});
