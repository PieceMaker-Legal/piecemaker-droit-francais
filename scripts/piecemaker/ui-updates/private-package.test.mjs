import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { encryptPackage, decryptPackage } from './windows-validation/private-package.mjs';

test('only the local private key decrypts the validated package and corruption leaves no plaintext', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-private-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const input = path.join(root, 'fixture.zip');
  const encrypted = path.join(root, 'fixture.enc');
  const output = path.join(root, 'restored.zip');
  await fs.writeFile(input, 'Fichier fictif ZETABIO.');
  await encryptPackage(input, encrypted, publicKey);
  assert.equal((await fs.readFile(encrypted)).includes(Buffer.from('ZETABIO')), false);
  await decryptPackage(encrypted, output, privateKey);
  assert.deepEqual(await fs.readFile(output), await fs.readFile(input));
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await assert.rejects(decryptPackage(encrypted, path.join(root, 'wrong.zip'), other.privateKey));
  const bytes = await fs.readFile(encrypted);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(encrypted, bytes);
  const corrupt = path.join(root, 'corrupt.zip');
  await assert.rejects(decryptPackage(encrypted, corrupt, privateKey));
  await assert.rejects(fs.access(corrupt));
  await assert.rejects(decryptPackage(encrypted, output, privateKey), { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(output), await fs.readFile(input));
});
