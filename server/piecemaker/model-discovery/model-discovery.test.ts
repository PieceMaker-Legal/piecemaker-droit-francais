import assert from 'node:assert/strict';
import test from 'node:test';

import { VIBE_REASONING_EFFORT } from '@/modules/providers/list/mistral/mistral-vibe-models.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

import { listCodexModels } from './codex-catalog.js';
import { installModelDiscovery } from './index.js';
import { listVibeModels } from './mistral-catalog.js';

const curatedCatalog: ProviderModelsDefinition = { OPTIONS: [{ value: 'curated', label: 'Curated' }], DEFAULT: 'curated' };
const catalogOf = (model: string): ProviderModelsDefinition => ({ OPTIONS: [{ value: model, label: model }], DEFAULT: model });

function fakeRegistry() {
  const models = {
    getSupportedModels: async () => curatedCatalog,
    getCurrentActiveModel: async () => ({ model: 'curated' }),
  };
  return { models, registry: { resolveProvider: () => ({ models }) } };
}

test('serves the discovered catalog and keeps it until it goes stale', async () => {
  const { models, registry } = fakeRegistry();
  let clock = 0;
  let calls = 0;
  installModelDiscovery(registry, {
    discoverers: { codex: async () => catalogOf(`discovered-${++calls}`) },
    refreshAfterMs: 100,
    now: () => clock,
  });

  assert.equal((await models.getSupportedModels()).DEFAULT, 'discovered-1');
  clock = 50;
  assert.equal((await models.getSupportedModels()).DEFAULT, 'discovered-1');
  assert.equal(calls, 1);

  clock = 150;
  assert.equal((await models.getSupportedModels()).DEFAULT, 'discovered-1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await models.getSupportedModels()).DEFAULT, 'discovered-2');
});

test('falls back to the curated catalog when the CLI cannot be queried', async () => {
  const { models, registry } = fakeRegistry();
  const warnings: string[] = [];
  installModelDiscovery(registry, {
    discoverers: { mistral: async () => { throw new Error('spawn vibe-app-server ENOENT'); } },
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(await models.getSupportedModels(), curatedCatalog);
  assert.match(warnings[0], /mistral model discovery failed: spawn vibe-app-server ENOENT/);
});

test('keeps the last discovered catalog when a later refresh fails', async () => {
  const { models, registry } = fakeRegistry();
  let clock = 0;
  let fail = false;
  installModelDiscovery(registry, {
    discoverers: { codex: async () => { if (fail) throw new Error('offline'); return catalogOf('discovered'); } },
    refreshAfterMs: 10,
    now: () => clock,
    warn: () => {},
  });

  await models.getSupportedModels();
  fail = true;
  clock = 20;
  await models.getSupportedModels();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await models.getSupportedModels()).DEFAULT, 'discovered');
});

test('maps codex model/list pages to options with their reasoning efforts', async () => {
  const pages: Record<string, unknown> = {
    first: {
      data: [
        { model: 'gpt-a', displayName: 'GPT-A', description: 'Frontier', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'ultra' }] },
        { model: 'gpt-hidden', hidden: true },
      ],
      nextCursor: 'second',
    },
    second: { data: [{ model: 'gpt-b', isDefault: true }], nextCursor: null },
  };
  const requested: unknown[] = [];
  const catalog = await listCodexModels(async (method, params) => {
    requested.push([method, params]);
    return pages[(params as { cursor: string | null }).cursor ?? 'first'];
  });

  assert.deepEqual(requested, [
    ['model/list', { cursor: null, includeHidden: false }],
    ['model/list', { cursor: 'second', includeHidden: false }],
  ]);
  assert.deepEqual(catalog, {
    OPTIONS: [
      {
        value: 'gpt-a',
        label: 'GPT-A',
        description: 'Frontier',
        effort: { default: 'low', values: [{ value: 'low', description: 'Fast' }, { value: 'ultra' }] },
      },
      { value: 'gpt-b', label: 'gpt-b' },
    ],
    DEFAULT: 'gpt-b',
  });
});

test('maps vibe config/read models to their aliases with effort where reasoning is adjustable', async () => {
  const catalog = await listVibeModels(async (method) => {
    assert.equal(method, 'config/read');
    return {
      config: {
        activeModel: { alias: 'devstral-small' },
        defaultModelAlias: 'mistral-medium-3.5',
        models: [
          { name: 'mistral-vibe-cli-latest', alias: 'mistral-medium-3.5', displayName: 'Mistral Medium 3.5' },
          { name: 'devstral-small-latest', alias: 'devstral-small', displayName: 'devstral-small' },
        ],
      },
    };
  });

  assert.deepEqual(catalog, {
    OPTIONS: [
      { value: 'mistral-medium-3.5', label: 'Mistral Medium 3.5', description: 'mistral-vibe-cli-latest', effort: VIBE_REASONING_EFFORT },
      { value: 'devstral-small', label: 'devstral-small', description: 'devstral-small-latest' },
    ],
    DEFAULT: 'devstral-small',
  });
});

test('rejects an empty catalog so the curated one is served instead', async () => {
  await assert.rejects(listCodexModels(async () => ({ data: [], nextCursor: null })), /listed no models/);
  await assert.rejects(listVibeModels(async () => ({ config: { models: [] } })), /listed no models/);
});
