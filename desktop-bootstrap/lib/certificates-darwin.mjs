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
  } catch {
    return false;
  }
}

async function issueLeaf({ commonName, keyPath, certPath, extensions, workDir }) {
  const configPath = path.join(workDir, `${commonName.replace(/\W+/g, '-')}.cnf`);
  const extensionsPath = path.join(workDir, `${commonName.replace(/\W+/g, '-')}.ext`);
  const csrPath = path.join(workDir, `${commonName.replace(/\W+/g, '-')}.csr`);

  await fs.writeFile(configPath, requestConfig(commonName), 'utf8');
  await fs.writeFile(extensionsPath, extensions, 'utf8');

  mustCapture('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', csrPath, '-config', configPath]);
  mustCapture('openssl', [
    'x509', '-req', '-in', csrPath,
    '-CA', caCertPath, '-CAkey', caKeyPath, '-CAcreateserial',
    '-out', certPath, '-days', DAYS, '-sha256', '-extfile', extensionsPath,
  ]);
  await fs.chmod(keyPath, 0o600);
}

export async function generateCertificates() {
  await fs.mkdir(certsDir, { recursive: true, mode: 0o700 });

  if (await exists(caCertPath)) {
    const stillValid = capture('openssl', ['x509', '-checkend', String(30 * 24 * 3600), '-noout', '-in', caCertPath]);
    if (stillValid.code === 0) {
      ui.ok('Certificats locaux déjà présents et valides.');
      return { regenerated: false };
    }
    ui.warn('Certificat local expiré ou expirant — régénération.');
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piecemaker-certs-'));
  try {
    const caConfigPath = path.join(workDir, 'ca.cnf');
    await fs.writeFile(caConfigPath, requestConfig(CA_COMMON_NAME), 'utf8');
    mustCapture('openssl', [
      'req', '-x509', '-newkey', 'rsa:4096', '-nodes',
      '-keyout', caKeyPath, '-out', caCertPath,
      '-days', DAYS, '-sha256', '-config', caConfigPath, '-extensions', 'v3_ca',
    ]);
    await fs.chmod(caKeyPath, 0o600);

    await issueLeaf({
      commonName: TLS_COMMON_NAME,
      keyPath: tlsKeyPath,
      certPath: tlsCertPath,
      extensions: TLS_EXTENSIONS,
      workDir,
    });

    await issueLeaf({
      commonName: SIGNING_COMMON_NAME,
      keyPath: signingKeyPath,
      certPath: signingCertPath,
      extensions: SIGNING_EXTENSIONS,
      workDir,
    });

    const passphrase = crypto.randomBytes(24).toString('base64url');
    mustCapture('openssl', [
      'pkcs12', '-export',
      '-inkey', signingKeyPath, '-in', signingCertPath, '-certfile', caCertPath,
      '-name', SIGNING_COMMON_NAME, '-out', signingBundlePath, '-passout', `pass:${passphrase}`,
      '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1',
    ]);
    await fs.writeFile(signingSecretPath, passphrase, { mode: 0o600 });

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
