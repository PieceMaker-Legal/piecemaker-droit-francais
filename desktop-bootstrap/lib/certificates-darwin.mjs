import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capture, mustCapture } from './shell.mjs';
import { runAuthorizationPanel } from './panel-darwin.mjs';
import { CONSENT_EXPLANATION, CONSENT_TITLE } from './consent.mjs';
import { ui } from './ui.mjs';
import {
  CA_COMMON_NAME,
  SIGNING_COMMON_NAME,
  TLS_COMMON_NAME,
  caCertPath,
  caKeyPath,
  certsDir,
  signingBundlePath,
  signingCertPath,
  signingKeyPath,
  signingSecretPath,
  tlsCertPath,
  tlsKeyPath,
} from './paths.mjs';

const DAYS = '825';
const KEYCHAIN_PATH = path.join(os.homedir(), 'Library', 'Keychains', 'piecemaker-signing.keychain-db');

function requestConfig(commonName) {
  return [
    '[req]',
    'distinguished_name = dn',
    'prompt = no',
    '',
    '[dn]',
    `CN = ${commonName}`,
    'O = PieceMaker',
    '',
    '[v3_ca]',
    'basicConstraints = critical,CA:true,pathlen:0',
    'keyUsage = critical,keyCertSign,cRLSign',
    'subjectKeyIdentifier = hash',
    '',
  ].join('\n');
}

const TLS_EXTENSIONS = [
  'basicConstraints = critical,CA:false',
  'keyUsage = critical,digitalSignature,keyEncipherment',
  'extendedKeyUsage = serverAuth',
  'subjectAltName = DNS:localhost,IP:127.0.0.1,IP:0:0:0:0:0:0:0:1',
  '',
].join('\n');

const SIGNING_EXTENSIONS = [
  'basicConstraints = critical,CA:false',
  'keyUsage = critical,digitalSignature',
  'extendedKeyUsage = critical,codeSigning',
  '',
].join('\n');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function issueLeaf({ commonName, keyPath, certPath, extensions, workDir, authorityCertPath, authorityKeyPath }) {
  const configPath = path.join(workDir, `${commonName.replace(/\W+/g, '-')}.cnf`);
  const extensionsPath = path.join(workDir, `${commonName.replace(/\W+/g, '-')}.ext`);
  const csrPath = path.join(workDir, `${commonName.replace(/\W+/g, '-')}.csr`);

  await fs.writeFile(configPath, requestConfig(commonName), 'utf8');
  await fs.writeFile(extensionsPath, extensions, 'utf8');

  mustCapture('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', csrPath, '-config', configPath]);
  mustCapture('openssl', [
    'x509', '-req', '-in', csrPath,
    '-CA', authorityCertPath, '-CAkey', authorityKeyPath, '-CAcreateserial', '-CAserial', path.join(workDir, 'ca.srl'),
    '-out', certPath, '-days', DAYS, '-sha256', '-extfile', extensionsPath,
  ]);
  await fs.chmod(keyPath, 0o600);
}

async function validCertificatePair(certPath, keyPath, { authority, usage } = {}) {
  let certificatePem;
  let keyPem;
  try {
    [certificatePem, keyPem] = await Promise.all([fs.readFile(certPath), fs.readFile(keyPath)]);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const certificate = new crypto.X509Certificate(certificatePem);
    const key = crypto.createPrivateKey(keyPem);
    const now = Date.now();
    if (!certificate.checkPrivateKey(key)
      || Date.parse(certificate.validFrom) > now
      || Date.parse(certificate.validTo) < now + 30 * 24 * 3600 * 1000) return null;
    if (!authority) {
      return certificate.ca && certificate.checkIssued(certificate) && certificate.verify(certificate.publicKey) ? certificate : null;
    }
    if (certificate.ca || !certificate.checkIssued(authority) || !certificate.verify(authority.publicKey)
      || !certificate.keyUsage?.includes(usage)) return null;
    if (usage === '1.3.6.1.5.5.7.3.1' && (!certificate.checkHost('localhost')
      || !certificate.checkIP('127.0.0.1') || !certificate.checkIP('::1'))) return null;
    return certificate;
  } catch {
    return null;
  }
}

async function validSigningBundle(certificate, authority) {
  let passphrase;
  try {
    passphrase = (await fs.readFile(signingSecretPath, 'utf8')).trim();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!passphrase) return false;
  try {
    const bundle = capture('openssl', ['pkcs12', '-in', signingBundlePath, '-nodes', '-passin', 'stdin'], { input: passphrase });
    if (bundle.code !== 0) return false;
    const certificates = [...bundle.stdout.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)]
      .map(([pem]) => new crypto.X509Certificate(pem).fingerprint256);
    return certificates.includes(certificate.fingerprint256) && certificates.includes(authority.fingerprint256)
      && certificate.checkPrivateKey(crypto.createPrivateKey(bundle.stdout));
  } catch {
    return false;
  }
}

export async function generateCertificates() {
  await fs.mkdir(certsDir, { recursive: true, mode: 0o700 });
  const files = [caCertPath, caKeyPath, tlsCertPath, tlsKeyPath, signingCertPath, signingKeyPath, signingBundlePath, signingSecretPath];
  const hasExistingFiles = (await Promise.all(files.map(exists))).some(Boolean);
  const authority = await validCertificatePair(caCertPath, caKeyPath);
  if (hasExistingFiles && !authority) {
    throw new Error(`Autorité locale incomplète, incohérente ou à renouveler dans ${certsDir}. Les fichiers existants sont conservés. Une clé perdue ne peut pas être reconstituée : restaurez sa clé et son certificat depuis une sauvegarde ; sinon, retirez explicitement la confiance de cette ancienne autorité du trousseau, archivez ce dossier puis relancez l’installation et autorisez la nouvelle autorité.`);
  }
  const tls = authority && await validCertificatePair(tlsCertPath, tlsKeyPath, { authority, usage: '1.3.6.1.5.5.7.3.1' });
  const signing = authority && await validCertificatePair(signingCertPath, signingKeyPath, { authority, usage: '1.3.6.1.5.5.7.3.3' });
  const bundleValid = signing && await validSigningBundle(signing, authority);
  if (tls && signing && bundleValid) {
    ui.ok('Certificats locaux déjà présents et valides.');
    return { regenerated: false };
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piecemaker-certs-'));
  const pendingFiles = new Map();
  const stage = (target) => {
    const staged = path.join(workDir, path.basename(target));
    pendingFiles.set(target, staged);
    return staged;
  };
  try {
    const authorityCertPath = authority ? caCertPath : stage(caCertPath);
    const authorityKeyPath = authority ? caKeyPath : stage(caKeyPath);
    if (!authority) {
      const caConfigPath = path.join(workDir, 'ca.cnf');
      await fs.writeFile(caConfigPath, requestConfig(CA_COMMON_NAME), 'utf8');
      mustCapture('openssl', [
        'req', '-x509', '-newkey', 'rsa:4096', '-nodes',
        '-keyout', authorityKeyPath, '-out', authorityCertPath,
        '-days', DAYS, '-sha256', '-config', caConfigPath, '-extensions', 'v3_ca',
      ]);
      await fs.chmod(authorityKeyPath, 0o600);
    }

    if (!tls) {
      await issueLeaf({
        commonName: TLS_COMMON_NAME,
        keyPath: stage(tlsKeyPath),
        certPath: stage(tlsCertPath),
        extensions: TLS_EXTENSIONS,
        workDir,
        authorityCertPath,
        authorityKeyPath,
      });
    }

    const currentSigningKeyPath = signing ? signingKeyPath : stage(signingKeyPath);
    const currentSigningCertPath = signing ? signingCertPath : stage(signingCertPath);
    if (!signing) {
      await issueLeaf({
        commonName: SIGNING_COMMON_NAME,
        keyPath: currentSigningKeyPath,
        certPath: currentSigningCertPath,
        extensions: SIGNING_EXTENSIONS,
        workDir,
        authorityCertPath,
        authorityKeyPath,
      });
    }

    if (!bundleValid) {
      const passphrase = crypto.randomBytes(24).toString('base64url');
      mustCapture('openssl', [
        'pkcs12', '-export',
        '-inkey', currentSigningKeyPath, '-in', currentSigningCertPath, '-certfile', authorityCertPath,
        '-name', SIGNING_COMMON_NAME, '-out', stage(signingBundlePath), '-passout', 'stdin',
        '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1',
      ], { input: passphrase });
      await fs.chmod(pendingFiles.get(signingBundlePath), 0o600);
      await fs.writeFile(stage(signingSecretPath), passphrase, { mode: 0o600 });
    }

    for (const [target, staged] of pendingFiles) {
      await fs.copyFile(staged, target);
      await fs.chmod(target, (await fs.stat(staged)).mode & 0o777);
    }
    ui.ok(`Certificats générés dans ${certsDir}`);
    return { regenerated: true };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export function isCaTrusted() {
  const result = capture('security', ['verify-cert', '-c', caCertPath, '-p', 'basic']);
  return result.code === 0;
}

function userKeychainPath() {
  const declared = capture('security', ['default-keychain', '-d', 'user']).stdout.replace(/^"|"$/g, '');
  if (declared) return declared;
  return path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
}

export async function trustCertificateAuthority() {
  const command = `security add-trusted-cert -r trustRoot -k '${userKeychainPath()}' '${caCertPath}'`;
  const { authorized } = await runAuthorizationPanel({
    title: CONSENT_TITLE,
    message: CONSENT_EXPLANATION,
    confirmLabel: 'Autoriser',
    cancelLabel: 'Annuler',
    command,
  });
  return authorized;
}

async function prepareSigningKeychain() {
  const passphrase = (await fs.readFile(signingSecretPath, 'utf8')).trim();

  capture('security', ['delete-keychain', KEYCHAIN_PATH]);
  mustCapture('security', ['create-keychain', '-p', passphrase, KEYCHAIN_PATH]);
  mustCapture('security', ['set-keychain-settings', KEYCHAIN_PATH]);
  mustCapture('security', ['unlock-keychain', '-p', passphrase, KEYCHAIN_PATH]);
  mustCapture('security', [
    'import', signingBundlePath,
    '-k', KEYCHAIN_PATH, '-P', passphrase,
    '-T', '/usr/bin/codesign', '-T', '/usr/bin/security',
  ]);
  mustCapture('security', [
    'set-key-partition-list',
    '-S', 'apple-tool:,apple:,codesign:',
    '-s', '-k', passphrase, KEYCHAIN_PATH,
  ]);

  const current = mustCapture('security', ['list-keychains', '-d', 'user'])
    .split('\n')
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter((line) => line && line !== KEYCHAIN_PATH);
  mustCapture('security', ['list-keychains', '-d', 'user', '-s', ...current, KEYCHAIN_PATH]);

  return KEYCHAIN_PATH;
}

export async function signApplication(appPath) {
  const keychain = await prepareSigningKeychain();
  const result = capture('codesign', [
    '--force', '--deep', '--sign', SIGNING_COMMON_NAME,
    '--keychain', keychain, '--timestamp=none', appPath,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'codesign a échoué.');
  }
  return SIGNING_COMMON_NAME;
}
