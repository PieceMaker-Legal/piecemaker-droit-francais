import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pisteCredentialsConfigured, savePisteCredentials, validatePisteCredentials } from './piste.mjs';

function temporaryEnvFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-piste-')), 'mcp-legifrance', '.env');
}

function fakeFetch(statuses) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const status = url.includes('oauth') ? statuses.token : url.includes('legifrance') ? statuses.legifrance : statuses.judilibre;
    if (status === 'offline') throw new Error('ECONNREFUSED');
    return {
      ok: status === 200,
      status,
      json: async () => ({ access_token: 'jeton' }),
    };
  };
  return { fetchImpl, calls };
}

test('enregistre les identifiants en conservant les autres réglages', () => {
  const file = temporaryEnvFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# réglages\nLEGIFRANCE_CLIENT_ID=ancien\nAUTRE_REGLAGE=1\n');
  assert.equal(pisteCredentialsConfigured(file), false);
  savePisteCredentials({ clientId: 'id-exemple', clientSecret: 'secret-exemple' }, file);
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    '# réglages\nLEGIFRANCE_CLIENT_ID=id-exemple\nAUTRE_REGLAGE=1\nLEGIFRANCE_CLIENT_SECRET=secret-exemple\nLEGIFRANCE_ENV=production\n',
  );
  assert.equal(pisteCredentialsConfigured(file), true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('valide le jeton puis Légifrance puis Judilibre', async () => {
  const { fetchImpl, calls } = fakeFetch({ token: 200, legifrance: 200, judilibre: 200 });
  assert.deepEqual(await validatePisteCredentials({ clientId: 'a', clientSecret: 'b' }, fetchImpl), { ok: true });
  assert.equal(calls.length, 3);
  assert.match(calls[2], /judilibre/);
});

test('distingue identifiants refusés, API non souscrite et réseau absent', async () => {
  const refused = await validatePisteCredentials({ clientId: 'a', clientSecret: 'b' }, fakeFetch({ token: 401 }).fetchImpl);
  assert.match(refused.message, /refuse ces identifiants/);
  const noJudilibre = await validatePisteCredentials(
    { clientId: 'a', clientSecret: 'b' },
    fakeFetch({ token: 200, legifrance: 200, judilibre: 403 }).fetchImpl,
  );
  assert.match(noJudilibre.message, /pas accès à JUDILIBRE/);
  const offline = await validatePisteCredentials({ clientId: 'a', clientSecret: 'b' }, fakeFetch({ token: 'offline' }).fetchImpl);
  assert.match(offline.message, /connexion Internet/);
});
