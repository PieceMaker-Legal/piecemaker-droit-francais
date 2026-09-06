import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { configureCodexProxy } = createRequire(import.meta.url)('./client-config.cjs');

test('le fournisseur Codex géré utilise HTTP Responses sans changer les autres fournisseurs', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-codex-http-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'config.toml'), 'model = "test"\n[model_providers.other]\nname = "Other"\nsupports_websockets = true\n');
  const result = configureCodexProxy({ baseUrl: 'http://127.0.0.1:4111/chatgpt', codexHome: dir });
  assert.equal(result.configured, true);
  const content = fs.readFileSync(result.file, 'utf8');
  assert.match(content, /base_url = "http:\/\/127.0.0.1:4111\/chatgpt"/);
  assert.match(content, /\[model_providers.other\]\nname = "Other"\nsupports_websockets = true/);
  assert.match(content, /\[model_providers.piecemaker_proxy\][\s\S]*supports_websockets = false/);
});
