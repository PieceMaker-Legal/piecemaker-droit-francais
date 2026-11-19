const assert = require('node:assert/strict');
const test = require('node:test');

async function connect(t) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createServer } = await import('./server.mjs');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  t.after(() => client.close());
  return client;
}

test('expose les outils du projet et exige la clé de session sur chacun', async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'ask_decision', 'close_decision', 'create_routine', 'delete_routine', 'edit_message',
    'get_project_settings', 'list_deliverables', 'list_devices', 'list_project_artifacts',
    'list_providers', 'list_routines', 'list_thread_connectors', 'list_threads', 'lookup',
    'message_thread', 'no_reply_needed', 'post_message', 'post_thread_card', 'post_widget',
    'propose_project_setup', 'react', 'read_memory', 'read_thread', 'rename_thread', 'send_later',
    'set_thread_reminder', 'set_thread_resolved', 'start_thread', 'suggest_connectors', 'switch_model',
    'unreact', 'update_deliverable', 'update_memory', 'update_project_settings', 'update_widget',
  ]);
  for (const tool of tools) {
    assert.ok(tool.description?.trim(), tool.name);
    assert.ok(tool.inputSchema.required.includes('session_key'), tool.name);
    assert.match(tool.inputSchema.properties.session_key.description, /wake/, tool.name);
  }
  const decision = tools.find(tool => tool.name === 'ask_decision');
  assert.match(decision.inputSchema.properties.recommended.description, /zéro/);
});

test('transmet les paramètres au serveur local et restitue son résultat et ses erreurs', async t => {
  const client = await connect(t);
  const port = '32001';
  const previous = process.env.PIECEMAKER_APP_PORT;
  process.env.PIECEMAKER_APP_PORT = port;
  t.after(() => {
    if (previous === undefined) delete process.env.PIECEMAKER_APP_PORT;
    else process.env.PIECEMAKER_APP_PORT = previous;
  });
  const args = { text: 'Exemple', attached_outputs: [{ kind: 'file', ref: 'exemple.txt' }] };
  const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = require('undici');
  const previousDispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  t.after(async () => {
    setGlobalDispatcher(previousDispatcher);
    await agent.close();
  });
  const local = agent.get(`http://127.0.0.1:${port}`);
  const request = {
    path: '/api/piecemaker/local/orchestrateur/call',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body => {
      assert.deepEqual(JSON.parse(body), {
        root: process.cwd(), session_key: 'cle-exemple', tool: 'post_message', args,
      });
      return true;
    },
  };
  local.intercept(request).reply(200, { message_id: 'msg_exemple' });
  const call = () => client.callTool({ name: 'post_message', arguments: { session_key: 'cle-exemple', ...args } });
  const posted = await call();
  assert.ok(!posted.isError, posted.content[0].text);
  assert.deepEqual(JSON.parse(posted.content[0].text), { message_id: 'msg_exemple' });
  local.intercept(request).reply(403, { error: 'Clé expirée.' });
  const refused = await call();
  assert.equal(refused.isError, true);
  assert.equal(refused.content[0].text, 'Clé expirée.');
});
