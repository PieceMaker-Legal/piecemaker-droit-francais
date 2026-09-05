import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getApplicationDataRoot } from '@/shared/utils.js';

test('getApplicationDataRoot preserves the historical default', () => {
  const previousValue = process.env.CLOUDCLI_HOME;
  delete process.env.CLOUDCLI_HOME;
  try {
    assert.equal(getApplicationDataRoot(), path.join(os.homedir(), '.cloudcli'));
  } finally {
    if (previousValue === undefined) delete process.env.CLOUDCLI_HOME;
    else process.env.CLOUDCLI_HOME = previousValue;
  }
});

test('getApplicationDataRoot isolates a configured fork', () => {
  const previousValue = process.env.CLOUDCLI_HOME;
  const forkRoot = path.join(os.tmpdir(), 'example-cloudcli-fork');
  process.env.CLOUDCLI_HOME = forkRoot;
  try {
    assert.equal(getApplicationDataRoot(), forkRoot);
  } finally {
    if (previousValue === undefined) delete process.env.CLOUDCLI_HOME;
    else process.env.CLOUDCLI_HOME = previousValue;
  }
});
