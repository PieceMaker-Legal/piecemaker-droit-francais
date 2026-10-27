import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyMistralSdk(applicationRoot) {
  const require = createRequire(path.join(applicationRoot, 'package.json'));
  const { Mistral } = await import(pathToFileURL(require.resolve('@mistralai/mistralai')).href);
  const { HTTPClient } = await import(pathToFileURL(require.resolve('@mistralai/mistralai/lib/http.js')).href);
  require.resolve('undici');
  const requests = [];
  const client = new Mistral({ apiKey: 'fictitious-validation-key', httpClient: new HTTPClient({ fetcher: async request => {
    requests.push(await request.json());
    const message = requests.length === 1
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'abcdef123', type: 'function', function: { name: 'probe', arguments: '{"value":"fixture"}' } }] }
      : { role: 'assistant', content: 'SDK_WINDOWS_OK' };
    return Response.json({ id: 'fixture', object: 'chat.completion', created: 1, model: 'mistral-small-latest', choices: [{ index: 0, message, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  } }) });
  const messages = [{ role: 'user', content: 'Test fictif du raccord SDK.' }];
  const first = await client.chat.complete({ model: 'mistral-small-latest', messages, tools: [{ type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: { value: { type: 'string' } } } } }] });
  const answer = first.choices[0].message;
  assert.equal(answer.toolCalls[0].function.name, 'probe');
  messages.push({ role: 'assistant', content: answer.content, toolCalls: answer.toolCalls }, { role: 'tool', toolCallId: 'abcdef123', content: 'Preuve fictive.' });
  const second = await client.chat.complete({ model: 'mistral-small-latest', messages });
  assert.equal(second.choices[0].message.content, 'SDK_WINDOWS_OK');
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'abcdef123');
  return { installed: true, tools: true, provider: 'mistral-sdk', networkUsed: false };
}
