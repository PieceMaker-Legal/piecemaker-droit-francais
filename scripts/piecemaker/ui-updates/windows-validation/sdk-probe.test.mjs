import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyMistralSdk } from './sdk-probe.mjs';

test('the packaged SDK probe validates a tool round trip without account credentials or Vibe', async () => {
  const result = await verifyMistralSdk(fileURLToPath(new URL('../../../../', import.meta.url)));
  assert.deepEqual(result, { installed: true, tools: true, provider: 'mistral-sdk', networkUsed: false });
});
