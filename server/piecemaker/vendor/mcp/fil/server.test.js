const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

test('le serveur stdio du fil expose trois outils et exige une clé de session', async t => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, 'server.mjs')],
  }));
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['ask_decision', 'message_orchestrator', 'reply']);
  for (const tool of tools) {
    assert.ok(tool.description?.trim(), tool.name);
    assert.ok(tool.inputSchema.required.includes('session_key'), tool.name);
    assert.match(tool.inputSchema.properties.session_key.description, /wake/, tool.name);
  }
  const decision = tools.find(tool => tool.name === 'ask_decision');
  assert.match(decision.inputSchema.properties.recommended.description, /zéro/);
  const refused = await client.callTool({ name: 'reply', arguments: { text: 'Exemple' } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /session_key/);
});
