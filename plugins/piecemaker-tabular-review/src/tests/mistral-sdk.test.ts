import { afterEach, expect, it, vi } from 'vitest';

import { openSession } from '../server/sessions.js';

const spawn = vi.hoisted(() => vi.fn(() => { throw new Error('CLI interdite dans ce test SDK.'); }));
vi.mock('node:child_process', () => ({ spawn }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('tabular Mistral uses the connected app account through a local capability and retains its conversation', async () => {
  const origin = 'http://127.0.0.1:3003/api/piecemaker/local/mistral-sdk/tabular';
  const token = 'a'.repeat(64);
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ origin, token }))
    .mockResolvedValueOnce(Response.json({ response: 'Première réponse fictive.' }))
    .mockResolvedValueOnce(Response.json({ response: 'Suite fictive.' }));
  vi.stubGlobal('fetch', fetch);
  const session = openSession({ provider: 'mistral', model: 'mistral-small-latest', mode: 'inline', system: 'Instructions fictives.', readableDirectory: '/dossier-exemple/docs', environment: { SERVER_PORT: '3003' }, signal: new AbortController().signal });
  await expect(session.send('Première question')).resolves.toBe('Première réponse fictive.');
  await expect(session.send('Deuxième question')).resolves.toBe('Suite fictive.');
  expect(spawn).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1][0]).toBe(origin);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${token}`);
  expect(JSON.parse(fetch.mock.calls[2][1].body).messages).toEqual([
    { role: 'user', content: 'Première question' }, { role: 'assistant', content: 'Première réponse fictive.' }, { role: 'user', content: 'Deuxième question' },
  ]);
  session.close();
  await expect(session.send('Après fermeture')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('an unconnected account reports the settings requirement without falling back to Vibe', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: { message: 'Connectez Mistral depuis les paramètres.' } }, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  const session = openSession({ provider: 'mistral', model: 'mistral-small-latest', mode: 'inline', system: '', readableDirectory: '/dossier-exemple', environment: {}, signal: new AbortController().signal });
  await expect(session.send('Bonjour')).rejects.toThrow('Connectez Mistral depuis les paramètres.');
  expect(spawn).not.toHaveBeenCalled();
});
