import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { scanAndPersistLibraryProviderConnectors, seedDefaultLibraryConnectors, REGISTRE_PUBLIC_CONNECTOR } from './provider-connectors.js';
import { createLibraryStore } from './store.js';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml');

test('connector scan seeds the default MCP and imports every provider user config once', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-mcp-'));
  const userHome = path.join(root, 'home');
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(userHome, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(userHome, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(userHome, '.config', 'opencode'), { recursive: true });
  fs.mkdirSync(path.join(userHome, '.grok'), { recursive: true });
  fs.writeFileSync(path.join(userHome, '.claude.json'), JSON.stringify({
    mcpServers: {
      [REGISTRE_PUBLIC_CONNECTOR.name]: { type: 'http', url: REGISTRE_PUBLIC_CONNECTOR.url },
      extra: { command: 'npx', args: ['-y', 'demo'] },
    },
  }));
  fs.writeFileSync(path.join(userHome, '.codex', 'config.toml'), TOML.stringify({
    mcp_servers: { extra: { command: 'npx', args: ['-y', 'demo'] } },
  }));
  fs.writeFileSync(path.join(userHome, '.cursor', 'mcp.json'), JSON.stringify({
    mcpServers: { extra: { command: 'npx', args: ['-y', 'demo'] } },
  }));
  fs.writeFileSync(path.join(userHome, '.config', 'opencode', 'opencode.json'), JSON.stringify({
    mcp: { extra: { type: 'local', command: ['npx', '-y', 'demo'] } },
  }));
  fs.writeFileSync(path.join(userHome, '.grok', 'config.toml'), TOML.stringify({
    mcp_servers: { extra: { command: 'npx', args: ['-y', 'demo'] } },
  }));

  seedDefaultLibraryConnectors(store);
  scanAndPersistLibraryProviderConnectors(store, userHome);
  const connectors = store.list().filter((entry) => entry.kind === 'connector');
  assert.equal(connectors.filter((entry) => entry.name === REGISTRE_PUBLIC_CONNECTOR.name).length, 1);
  assert.equal(connectors.filter((entry) => entry.name === 'extra').length, 1);
  assert.equal(connectors.length, 2);
});
