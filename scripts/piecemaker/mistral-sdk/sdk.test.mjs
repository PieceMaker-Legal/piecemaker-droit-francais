import assert from 'node:assert/strict';
import test from 'node:test';
import { Mistral } from '@mistralai/mistralai';
import { HTTPClient } from '@mistralai/mistralai/lib/http.js';

test('the JavaScript SDK authenticates and decodes a completion without Python', async () => {
  let request;
  const client = new Mistral({
    apiKey: 'fictitious-key',
    httpClient: new HTTPClient({ fetcher: async value => {
      request = value;
      return Response.json({
        id: 'fictitious-response', object: 'chat.completion', created: 1, model: 'mistral-small-latest',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Connexion Mistral réussie.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    } }),
  });
  const response = await client.chat.complete({ model: 'mistral-small-latest', messages: [{ role: 'user', content: 'Essai fictif.' }], maxTokens: 32 });
  assert.equal(request.headers.get('authorization'), 'Bearer fictitious-key');
  assert.equal(new URL(request.url).pathname, '/v1/chat/completions');
  assert.equal(response.choices[0].message.content, 'Connexion Mistral réussie.');
});
