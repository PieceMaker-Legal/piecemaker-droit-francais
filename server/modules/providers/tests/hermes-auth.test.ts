import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { HermesProviderAuth } from '@/modules/providers/list/hermes/hermes-auth.provider.js';

test('Hermes recognizes current OAuth stores in its active home without exposing tokens', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-auth-'));
  const previous = process.env;
  try {
    const cli = path.join(temporary, 'hermes.mjs');
    fs.writeFileSync(cli, 'process.exit(0);');
    process.env = { PATH: previous.PATH, HOME: temporary, HERMES_HOME: temporary, HERMES_CLI_PATH: `${process.execPath} ${cli}` };
    const auth = new HermesProviderAuth();
    for (const payload of [
      { providers: { 'openai-codex': { access_token: 'fictitious-token' } } },
      { credential_pool: { anthropic: [{ access_token: 'fictitious-token' }] } },
    ]) {
      fs.writeFileSync(path.join(temporary, 'auth.json'), JSON.stringify(payload));
      const status = await auth.getStatus();
      assert.equal(status.installed, true);
      assert.equal(status.authenticated, true);
      assert.equal(JSON.stringify(status).includes('fictitious-token'), false);
    }
    fs.writeFileSync(path.join(temporary, 'auth.json'), JSON.stringify({ credential_pool: { anthropic: [{ access_token: 'fictitious-token', last_status: 'dead' }] } }));
    assert.equal((await auth.getStatus()).authenticated, false);
  } finally {
    process.env = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
