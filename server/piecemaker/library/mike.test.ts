import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';

import express from 'express';

import { createMikeRouter } from './mike.js';
import { createLibraryStore } from './store.js';

function writeMikeRepository(target: string) {
  const write = (relative: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
    fs.writeFileSync(path.join(target, relative), content);
  };
  fs.mkdirSync(path.join(target, '.git'), { recursive: true });
  write('assistant-workflows/relecture-exemple/SKILL.md', '---\nname: "relecture-exemple"\ndescription: "Relire un acte exemple."\nmetadata:\n  mike-display-name: "Relecture exemple"\n---\nInstructions.\n');
  write('assistant-workflows/exemple-pack/pack.yaml', 'id: exemple\n');
  write('assistant-workflows/exemple-pack/synthese-exemple/SKILL.md', '---\nname: "synthese-exemple"\ndescription: "Synthèse."\n---\nInstructions.\n');
  write('tabular-review-workflows/bail-exemple-tabular-review/SKILL.md', '---\nname: "bail-exemple-tabular-review"\ndescription: "Revue d’un bail exemple."\nmetadata:\n  mike-display-name: "Revue de bail exemple"\n---\nInstructions.\n');
  write('tabular-review-workflows/bail-exemple-tabular-review/table-columns.yaml', [
    'columns:',
    '  - index: 1',
    '    name: "Loyer"',
    '    format: "monetary_amount"',
    '    prompt: >-',
    '      Quel est le loyer ?',
    '  - index: 0',
    '    name: Nature',
    '    format: tag',
    '    tags: ["Commercial", "Habitation"]',
    '    prompt: Quelle est la nature du bail ?',
    '',
  ].join('\n'));
}

async function served(router: express.Router, run: (call: (method: string, url: string, body?: unknown) => Promise<any>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Adresse HTTP indisponible.');
  try {
    await run(async (method, url, body) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return response.json();
    });
  } finally { server.close(); }
}

test('Mike workflows are cloned, listed as skills and tabular reviews, and added where they belong', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-mike-'));
  const userHome = path.join(root, 'home');
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const calls: string[][] = [];
  const run = (command: string, args: string[]) => {
    calls.push([command, ...args]);
    if (args[0] === 'clone') writeMikeRepository(args.at(-1) as string);
    return { ok: true, output: '', status: 0 };
  };
  await served(createMikeRouter(store, userHome, run), async (call) => {
    const before = await call('GET', '/plugin/marketplace?scope=mike&kind=skill');
    assert.equal(before.registered, false);
    assert.deepEqual(before.plugins, []);

    assert.equal((await call('POST', '/plugin/marketplace/register', { scope: 'mike' })).ok, true);
    assert.ok(calls[0].includes('https://github.com/Open-Legal-Products/mike-workflows.git'));

    const skills = await call('GET', '/plugin/marketplace?scope=mike&kind=skill');
    assert.equal(skills.registered, true);
    assert.deepEqual(skills.plugins.map((entry: { name: string }) => entry.name), ['Relecture exemple', 'synthese-exemple']);
    assert.equal((await call('GET', '/plugin/marketplace?scope=mike&kind=plugin')).plugins.length, 0);

    assert.equal((await call('POST', '/plugin/marketplace/acquire', { scope: 'mike', id: 'relecture-exemple@mike-workflows' })).ok, true);
    const skill = store.list().find((entry) => entry.kind === 'skill');
    assert.equal(skill?.name, 'relecture-exemple');
    assert.equal(skill?.collectionId, null);
    assert.equal((await call('GET', '/plugin/marketplace?scope=mike&kind=skill')).plugins[0].installed, true);

    const tabular = await call('GET', '/plugin/marketplace?scope=mike&kind=tabular');
    assert.deepEqual(tabular.plugins.map((entry: { id: string }) => entry.id), ['bail-exemple-tabular-review@mike-workflows']);
    assert.equal((await call('POST', '/plugin/marketplace/acquire', { scope: 'mike', kind: 'tabular', id: 'bail-exemple-tabular-review@mike-workflows' })).ok, true);
    const { templates } = await call('GET', '/tabular');
    assert.equal(templates[0].id, 'mike-bail-exemple-tabular-review');
    assert.equal(templates[0].name, 'Revue de bail exemple');
    assert.deepEqual(templates[0].columns, [
      { name: 'Nature', prompt: 'Quelle est la nature du bail ?', format: 'tags', tags: ['Commercial', 'Habitation'] },
      { name: 'Loyer', prompt: 'Quel est le loyer ?', format: 'amount' },
    ]);
    assert.ok(fs.existsSync(path.join(userHome, '.piecemaker', 'tabular-review', 'library', 'mike-bail-exemple-tabular-review.json')));
    assert.equal((await call('GET', '/plugin/marketplace?scope=mike&kind=tabular')).plugins[0].installed, true);

    assert.deepEqual((await call('DELETE', '/tabular/mike-bail-exemple-tabular-review')).templates, []);

    assert.equal((await call('POST', '/plugin/marketplace/register', { scope: 'mike' })).ok, true);
    assert.deepEqual(calls.at(-1)?.slice(0, 4), ['git', '-C', path.join(store.directory, 'mike-workflows'), 'pull']);
  });
});

test('other marketplaces fall through to the next router', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-mike-next-'));
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const router = express.Router();
  router.use(createMikeRouter(store, path.join(root, 'home'), () => { throw new Error('inattendu'); }));
  router.get('/plugin/marketplace', (_req, res) => { res.json({ next: true }); });
  await served(router, async (call) => {
    assert.equal((await call('GET', '/plugin/marketplace?scope=legal&kind=skill')).next, true);
  });
});
