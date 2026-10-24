import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const names = {
  caCert: 'piecemaker-ca.crt',
  caKey: 'piecemaker-ca.key',
  tlsCert: 'localhost.crt',
  tlsKey: 'localhost.key',
  signingCert: 'piecemaker-signing.crt',
  signingKey: 'piecemaker-signing.key',
  bundle: 'piecemaker-signing.p12',
  secret: 'signing-keychain.secret',
};

function openssl(args, input) {
  return execFileSync('openssl', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

async function snapshot(directory) {
  const entries = await fs.readdir(directory);
  return Object.fromEntries(await Promise.all(entries.sort().map(async (name) => [name, {
    hash: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex'),
    mode: (await fs.stat(path.join(directory, name))).mode & 0o777,
  }])));
}

async function assertHealthy(directory) {
  const file = (name) => path.join(directory, names[name]);
  const authority = new crypto.X509Certificate(await fs.readFile(file('caCert')));
  assert.ok(authority.ca);
  for (const [cert, key, usage] of [
    ['caCert', 'caKey'],
    ['tlsCert', 'tlsKey', '1.3.6.1.5.5.7.3.1'],
    ['signingCert', 'signingKey', '1.3.6.1.5.5.7.3.3'],
  ]) {
    const certificate = new crypto.X509Certificate(await fs.readFile(file(cert)));
    assert.ok(certificate.checkPrivateKey(crypto.createPrivateKey(await fs.readFile(file(key)))));
    assert.ok(certificate.verify(authority.publicKey));
    assert.ok(Date.parse(certificate.validTo) > Date.now() + 30 * 24 * 3600 * 1000);
    if (usage) assert.ok(certificate.keyUsage.includes(usage));
    if (process.platform !== 'win32') assert.equal((await fs.stat(file(key))).mode & 0o777, 0o600);
  }
  const tls = new crypto.X509Certificate(await fs.readFile(file('tlsCert')));
  assert.ok(tls.checkHost('localhost'));
  assert.ok(tls.checkIP('127.0.0.1'));
  assert.ok(tls.checkIP('::1'));
  openssl(['verify', '-CAfile', file('caCert'), '-purpose', 'sslserver', file('tlsCert')]);
  openssl(['verify', '-CAfile', file('caCert'), file('signingCert')]);
  const passphrase = await fs.readFile(file('secret'), 'utf8');
  const bundle = openssl(['pkcs12', '-in', file('bundle'), '-nodes', '-passin', 'stdin'], passphrase);
  const signing = new crypto.X509Certificate(await fs.readFile(file('signingCert')));
  assert.ok(signing.checkPrivateKey(crypto.createPrivateKey(bundle)));
  const fingerprints = [...bundle.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)]
    .map(([pem]) => new crypto.X509Certificate(pem).fingerprint256);
  assert.ok(fingerprints.includes(signing.fingerprint256));
  assert.ok(fingerprints.includes(authority.fingerprint256));
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(file('bundle'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(file('secret'))).mode & 0o777, 0o600);
  }
}

test('réparation macOS avec OpenSSL et fichiers temporaires, sans accès au trousseau', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-certificates-'));
  const previousHome = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = path.join(root, 'home');
  const { generateCertificates } = await import('./certificates-darwin.mjs');
  const directory = path.join(process.env.PIECEMAKER_HOME, 'certs');
  const fixture = path.join(root, 'fixture');
  const file = (name) => path.join(directory, names[name]);
  const restore = async () => {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.cp(fixture, directory, { recursive: true });
  };
  const issueTls = async ({ authorityCert = file('caCert'), authorityKey = file('caKey'), days = '825', hosts = 'DNS:localhost,IP:127.0.0.1,IP:::1' } = {}) => {
    const csr = path.join(root, 'localhost.csr');
    const extensions = path.join(root, 'localhost.ext');
    await fs.writeFile(extensions, ['basicConstraints=critical,CA:false', 'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth', `subjectAltName=${hosts}`, ''].join('\n'));
    openssl(['req', '-new', '-key', file('tlsKey'), '-out', csr, '-subj', '/CN=localhost']);
    openssl(['x509', '-req', '-in', csr, '-CA', authorityCert, '-CAkey', authorityKey,
      '-set_serial', '12345', '-out', file('tlsCert'), '-days', days, '-extfile', extensions]);
  };
  const assertBlockedWithoutMutation = async () => {
    const before = await snapshot(directory);
    await assert.rejects(generateCertificates(), (error) => {
      assert.match(error.message, /Autorité locale incomplète, incohérente ou à renouveler/);
      assert.ok(error.message.includes(directory));
      assert.match(error.message, /restaurez.*sauvegarde.*retirez explicitement.*confiance.*autorisez la nouvelle autorité/);
      return true;
    });
    assert.deepEqual(await snapshot(directory), before);
  };
  try {
    await t.test('génère une chaîne complète puis la réutilise sans modifier les fichiers', async () => {
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
      const before = await snapshot(directory);
      assert.deepEqual(await generateCertificates(), { regenerated: false });
      assert.deepEqual(await snapshot(directory), before);
      await fs.cp(directory, fixture, { recursive: true });
    });

    const baseline = await snapshot(fixture);
    for (const name of ['tlsCert', 'tlsKey', 'signingCert', 'signingKey', 'bundle', 'secret']) {
      for (const damage of ['suppression', 'corruption']) {
        await t.test(`répare ${names[name]} après ${damage} sous la même autorité`, async () => {
          await restore();
          if (damage === 'suppression') await fs.rm(file(name));
          else await fs.writeFile(file(name), 'corrompu');
          assert.deepEqual(await generateCertificates(), { regenerated: true });
          await assertHealthy(directory);
          const after = await snapshot(directory);
          const repaired = name.startsWith('tls') ? ['tlsCert', 'tlsKey']
            : name.startsWith('signing') ? ['signingCert', 'signingKey', 'bundle', 'secret'] : ['bundle', 'secret'];
          for (const [key, filename] of Object.entries(names)) {
            if (!repaired.includes(key)) assert.deepEqual(after[filename], baseline[filename]);
          }
          assert.deepEqual(await generateCertificates(), { regenerated: false });
        });
      }
    }

    for (const name of ['caCert', 'caKey']) {
      for (const damage of ['suppression', 'corruption']) {
        await t.test(`refuse ${names[name]} après ${damage} sans mutation`, async () => {
          await restore();
          if (damage === 'suppression') await fs.rm(file(name));
          else await fs.writeFile(file(name), 'corrompu');
          await assertBlockedWithoutMutation();
        });
      }
    }

    await t.test('refuse une clé de CA valide appartenant à un autre certificat', async () => {
      await restore();
      await fs.copyFile(file('signingKey'), file('caKey'));
      await assertBlockedWithoutMutation();
    });

    await t.test('refuse une CA lisible dont la signature a été altérée', async () => {
      await restore();
      const certificate = new crypto.X509Certificate(await fs.readFile(file('caCert'))).raw;
      certificate[certificate.length - 1] ^= 1;
      await fs.writeFile(file('caCert'), `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64')}\n-----END CERTIFICATE-----\n`);
      await assertBlockedWithoutMutation();
    });

    await t.test('refuse la disparition des deux fichiers de CA quand les dérivés subsistent', async () => {
      await restore();
      await fs.rm(file('caCert'));
      await fs.rm(file('caKey'));
      await assertBlockedWithoutMutation();
    });

    for (const validity of ['expirée', 'moins de trente jours', 'pas encore valide']) {
      await t.test(`refuse une autorité ${validity} sans mutation`, async () => {
        await restore();
        const authority = new crypto.X509Certificate(await fs.readFile(file('caCert')));
        const now = Date.now;
        Date.now = () => validity === 'expirée' ? Date.parse(authority.validTo) + 1000
          : validity === 'moins de trente jours' ? Date.parse(authority.validTo) - 29 * 24 * 3600 * 1000
            : Date.parse(authority.validFrom) - 1000;
        try {
          await assertBlockedWithoutMutation();
        } finally {
          Date.now = now;
        }
      });
    }

    await t.test('répare une clé TLS valide mais non appariée', async () => {
      await restore();
      await fs.copyFile(file('signingKey'), file('tlsKey'));
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
      assert.deepEqual((await snapshot(directory))[names.caCert], baseline[names.caCert]);
    });

    await t.test('répare un certificat TLS apparié mais réservé à la signature de code', async () => {
      await restore();
      await fs.copyFile(file('signingKey'), file('tlsKey'));
      await fs.copyFile(file('signingCert'), file('tlsCert'));
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
    });

    await t.test('répare un certificat de signature apparié mais réservé au TLS', async () => {
      await restore();
      await fs.copyFile(file('tlsKey'), file('signingKey'));
      await fs.copyFile(file('tlsCert'), file('signingCert'));
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
    });

    await t.test('répare un certificat TLS sans les adresses de boucle locale', async () => {
      await restore();
      await issueTls({ hosts: 'DNS:localhost' });
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
    });

    await t.test('répare un certificat TLS à renouveler et garde la CA valide', async () => {
      await restore();
      await issueTls({ days: '10' });
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
      assert.deepEqual((await snapshot(directory))[names.caCert], baseline[names.caCert]);
    });

    await t.test('répare un certificat TLS signé par une autre autorité de même nom', async () => {
      await restore();
      const authorityCert = path.join(root, 'other-ca.crt');
      const authorityKey = path.join(root, 'other-ca.key');
      openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', authorityKey,
        '-out', authorityCert, '-days', '825', '-subj', '/CN=PieceMaker Local CA']);
      await issueTls({ authorityCert, authorityKey });
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
      assert.deepEqual((await snapshot(directory))[names.caCert], baseline[names.caCert]);
    });

    await t.test('conserve tous les fichiers si OpenSSL échoue avant la publication des réparations', async () => {
      await restore();
      await fs.rm(file('signingCert'));
      const before = await snapshot(directory);
      const previousPath = process.env.PATH;
      process.env.PATH = path.join(root, 'absent');
      try {
        await assert.rejects(generateCertificates(), /openssl .*a échoué/);
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      }
      assert.deepEqual(await snapshot(directory), before);
    });

    await t.test('répare un P12 lisible dont la clé et le certificat ne sont pas ceux de signature', async () => {
      await restore();
      const passphrase = await fs.readFile(file('secret'), 'utf8');
      openssl(['pkcs12', '-export', '-inkey', file('tlsKey'), '-in', file('tlsCert'),
        '-certfile', file('caCert'), '-out', file('bundle'), '-passout', 'stdin'], passphrase);
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
      const after = await snapshot(directory);
      assert.deepEqual(after[names.signingCert], baseline[names.signingCert]);
      assert.deepEqual(after[names.signingKey], baseline[names.signingKey]);
    });

    await t.test('répare un P12 sans la CA et conserve la paire de signature', async () => {
      await restore();
      const passphrase = await fs.readFile(file('secret'), 'utf8');
      openssl(['pkcs12', '-export', '-inkey', file('signingKey'), '-in', file('signingCert'),
        '-out', file('bundle'), '-passout', 'stdin'], passphrase);
      assert.deepEqual(await generateCertificates(), { regenerated: true });
      await assertHealthy(directory);
      assert.deepEqual((await snapshot(directory))[names.signingCert], baseline[names.signingCert]);
    });
  } finally {
    if (previousHome === undefined) delete process.env.PIECEMAKER_HOME;
    else process.env.PIECEMAKER_HOME = previousHome;
    await fs.rm(root, { recursive: true, force: true });
  }
});
