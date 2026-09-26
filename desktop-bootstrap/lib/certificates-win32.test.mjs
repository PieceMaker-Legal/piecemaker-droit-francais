import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { authorityPemFromWindowsExport } from './certificates-win32.mjs';

const JWK_FIELDS = { Modulus: 'n', Exponent: 'e', D: 'd', P: 'p', Q: 'q', DP: 'dp', DQ: 'dq', InverseQ: 'qi' };

function authorityOnDisk() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-win-ca-'));
  const cert = path.join(directory, 'ca.crt');
  const key = path.join(directory, 'ca.key');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=PieceMaker Local CA', '-addext', 'basicConstraints=critical,CA:true,pathlen:0',
  ], { stdio: 'ignore' });
  return { cert: fs.readFileSync(cert, 'utf8'), key: fs.readFileSync(key, 'utf8') };
}

function dotnetExport({ cert, key }, padLength = 0) {
  const jwk = crypto.createPrivateKey(key).export({ format: 'jwk' });
  const parameters = {};
  for (const [parameter, field] of Object.entries(JWK_FIELDS)) {
    const bytes = Buffer.from(jwk[field], 'base64url');
    const padded = parameter === 'D' && padLength > bytes.length ? Buffer.concat([Buffer.alloc(padLength - bytes.length), bytes]) : bytes;
    parameters[parameter] = padded.toString('base64');
  }
  return { certificate: new crypto.X509Certificate(cert).raw.toString('base64'), key: parameters };
}

test("l'export Windows devient un certificat PEM et une clé PKCS#8 appariés", () => {
  const authority = authorityOnDisk();
  const { certificatePem, keyPem } = authorityPemFromWindowsExport(dotnetExport(authority, 256));
  assert.match(certificatePem, /^-----BEGIN CERTIFICATE-----/);
  assert.match(keyPem, /^-----BEGIN PRIVATE KEY-----/);
  assert.ok(new crypto.X509Certificate(certificatePem).checkPrivateKey(crypto.createPrivateKey(keyPem)));
  assert.equal(new crypto.X509Certificate(certificatePem).fingerprint256, new crypto.X509Certificate(authority.cert).fingerprint256);
});

test("une clé qui n'appartient pas à l'autorité est refusée", () => {
  const authority = authorityOnDisk();
  const stranger = authorityOnDisk();
  const exported = dotnetExport(authority);
  exported.key = dotnetExport(stranger).key;
  assert.throws(() => authorityPemFromWindowsExport(exported), /ne correspond pas/);
});

test('un paramètre RSA manquant est signalé', () => {
  const exported = dotnetExport(authorityOnDisk());
  delete exported.key.InverseQ;
  assert.throws(() => authorityPemFromWindowsExport(exported), /InverseQ/);
});
