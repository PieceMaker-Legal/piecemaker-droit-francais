import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { installDefaultConnectors, REGISTRE_PUBLIC_CONNECTOR } from './default-connectors.mjs';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml');

test('installs the Registre Public connector in Claude and Codex user configuration', () => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-library-'));
  try {
    const claudePath = path.join(userHome, '.claude.json');
    const codexPath = path.join(userHome, '.codex', 'config.toml');
    fs.writeFileSync(claudePath, JSON.stringify({ mcpServers: { existing: { type: 'http', url: 'https://example.com/mcp' } } }));
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    fs.writeFileSync(codexPath, TOML.stringify({ mcp_servers: { existing: { url: 'https://example.com/mcp' } } }));

    assert.deepEqual(installDefaultConnectors(userHome), { claudeAdded: true, codexAdded: true });

    const claudeConfig = JSON.parse(fs.readFileSync(claudePath, 'utf8'));
    const codexConfig = TOML.parse(fs.readFileSync(codexPath, 'utf8'));
    assert.deepEqual(claudeConfig.mcpServers.existing, { type: 'http', url: 'https://example.com/mcp' });
    assert.deepEqual(claudeConfig.mcpServers[REGISTRE_PUBLIC_CONNECTOR.name], { type: 'http', url: REGISTRE_PUBLIC_CONNECTOR.url });
    assert.deepEqual(codexConfig.mcp_servers.existing, { url: 'https://example.com/mcp' });
    assert.deepEqual(codexConfig.mcp_servers[REGISTRE_PUBLIC_CONNECTOR.name], { url: REGISTRE_PUBLIC_CONNECTOR.url });
    assert.deepEqual(installDefaultConnectors(userHome), { claudeAdded: false, codexAdded: false });
  } finally {
    fs.rmSync(userHome, { recursive: true, force: true });
  }
});
