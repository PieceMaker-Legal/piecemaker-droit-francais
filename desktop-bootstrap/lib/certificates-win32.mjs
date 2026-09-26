import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { capture, powershell } from './shell.mjs';
import { askCertificateConsent } from './consent.mjs';
import { ui } from './ui.mjs';
import {
  CA_COMMON_NAME,
  PRODUCT_NAME,
  SIGNING_COMMON_NAME,
  caCertPath,
  caKeyPath,
  certsDir,
  signingCertPath,
  signingSecretPath,
} from './paths.mjs';

const tlsBundlePath = path.join(certsDir, 'localhost.pfx');
const tlsCertPath = path.join(certsDir, 'localhost.crt');
const signingBundlePath = path.join(certsDir, 'piecemaker-signing.pfx');
const thumbprintsPath = path.join(certsDir, 'thumbprints.json');

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

const AUTHORITY_PROVIDER = 'Microsoft Enhanced RSA and AES Cryptographic Provider';
const RSA_PARAMETERS = ['Modulus', 'Exponent', 'D', 'P', 'Q', 'DP', 'DQ', 'InverseQ'];
const JWK_FIELDS = { Modulus: 'n', Exponent: 'e', D: 'd', P: 'p', Q: 'q', DP: 'dp', DQ: 'dq', InverseQ: 'qi' };

export function authorityPemFromWindowsExport({ certificate, key }) {
  const x509 = new crypto.X509Certificate(Buffer.from(certificate, 'base64'));
  const jwk = { kty: 'RSA' };
  for (const [parameter, field] of Object.entries(JWK_FIELDS)) {
    if (!key?.[parameter]) throw new Error(`Paramètre RSA ${parameter} absent de l'export de l'autorité.`);
    jwk[field] = Buffer.from(key[parameter], 'base64').toString('base64url');
  }
  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  if (!x509.checkPrivateKey(privateKey)) {
    throw new Error("La clé exportée ne correspond pas au certificat de l'autorité locale.");
  }
  return { certificatePem: x509.toString(), keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function authorityIsUsable() {
  try {
    const x509 = new crypto.X509Certificate(await fs.readFile(caCertPath, 'utf8'));
    const key = crypto.createPrivateKey(await fs.readFile(caKeyPath, 'utf8'));
    return x509.checkPrivateKey(key) && Boolean(await readJson(thumbprintsPath));
  } catch {
    return false;
  }
}

function removeFromPersonalStore(thumbprints) {
  const targets = [thumbprints?.ca, thumbprints?.tls, thumbprints?.signing].filter(Boolean);
  if (targets.length === 0) return;
  capture('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', targets.map((thumbprint) => `Remove-Item -ErrorAction SilentlyContinue ${quote(`Cert:\\CurrentUser\\My\\${thumbprint}`)}`).join('; '),
  ]);
}

export async function generateCertificates() {
  await fs.mkdir(certsDir, { recursive: true });

  if (await authorityIsUsable()) {
    ui.ok('Certificats locaux déjà présents.');
    return { regenerated: false };
  }

  const previous = await readJson(thumbprintsPath);
  if (previous) ui.warn("Autorité locale sans clé exploitable par le proxy d'anonymisation — régénération.");

  const passphrase = crypto.randomBytes(24).toString('base64url');
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$password = ConvertTo-SecureString -String ${quote(passphrase)} -Force -AsPlainText`,
    '$expiry = (Get-Date).AddDays(825)',
    `$ca = New-SelfSignedCertificate -Subject ${quote(`CN=${CA_COMMON_NAME}, O=${PRODUCT_NAME}`)} -Provider ${quote(AUTHORITY_PROVIDER)} -KeySpec Signature -KeyUsage CertSign,CRLSign,DigitalSignature -KeyExportPolicy Exportable -KeyLength 4096 -HashAlgorithm SHA256 -NotAfter $expiry -CertStoreLocation Cert:\\CurrentUser\\My -TextExtension @("2.5.29.19={text}CA=true&pathlength=0")`,
    `$tls = New-SelfSignedCertificate -Subject ${quote('CN=localhost')} -DnsName "localhost","127.0.0.1" -Signer $ca -KeyExportPolicy Exportable -HashAlgorithm SHA256 -NotAfter $expiry -CertStoreLocation Cert:\\CurrentUser\\My -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")`,
    `$signing = New-SelfSignedCertificate -Subject ${quote(`CN=${SIGNING_COMMON_NAME}, O=${PRODUCT_NAME}`)} -Type CodeSigningCert -Signer $ca -KeyExportPolicy Exportable -HashAlgorithm SHA256 -NotAfter $expiry -CertStoreLocation Cert:\\CurrentUser\\My`,
    `Export-Certificate -Cert $tls -FilePath ${quote(tlsCertPath)} -Type CERT | Out-Null`,
    `Export-Certificate -Cert $signing -FilePath ${quote(signingCertPath)} -Type CERT | Out-Null`,
    `Export-PfxCertificate -Cert $tls -FilePath ${quote(tlsBundlePath)} -Password $password | Out-Null`,
    `Export-PfxCertificate -Cert $signing -FilePath ${quote(signingBundlePath)} -Password $password | Out-Null`,
    '$rsa = $ca.PrivateKey',
    'if (-not $rsa) { $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($ca) }',
    '$parameters = $rsa.ExportParameters($true)',
    `$key = @{}; foreach ($name in @(${RSA_PARAMETERS.map((name) => `'${name}'`).join(',')})) { $key[$name] = [Convert]::ToBase64String($parameters.$name) }`,
    'ConvertTo-Json -Compress -Depth 4 @{ ca = $ca.Thumbprint; tls = $tls.Thumbprint; signing = $signing.Thumbprint; authority = @{ certificate = [Convert]::ToBase64String($ca.RawData); key = $key } }',
  ].join('; ');

  const generated = JSON.parse(powershell(script));
  const { certificatePem, keyPem } = authorityPemFromWindowsExport(generated.authority);
  await fs.writeFile(caCertPath, certificatePem, 'utf8');
  await fs.writeFile(caKeyPath, keyPem, { encoding: 'utf8', mode: 0o600 });

  const thumbprints = { ca: generated.ca, tls: generated.tls, signing: generated.signing };
  if (previous) {
    removeFromPersonalStore(previous);
    thumbprints.previous = { ca: previous.ca, signing: previous.signing };
  }
  await fs.writeFile(thumbprintsPath, `${JSON.stringify(thumbprints, null, 2)}\n`, 'utf8');
  await fs.writeFile(signingSecretPath, passphrase, 'utf8');

  ui.ok(`Certificats générés dans ${certsDir}`);
  return { regenerated: true };
}

async function readThumbprints() {
  return JSON.parse(await fs.readFile(thumbprintsPath, 'utf8'));
}

export function isCaTrusted() {
  const result = capture('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', `if (Test-Path ${quote(thumbprintsPath)}) { $t = (Get-Content ${quote(thumbprintsPath)} | ConvertFrom-Json).ca; if (Test-Path "Cert:\\CurrentUser\\Root\\$t") { "yes" } else { "no" } } else { "no" }`,
  ]);
  return result.stdout.trim() === 'yes';
}

export async function trustCertificateAuthority() {
  if (!askCertificateConsent()) return false;

  const { signing, previous } = await readThumbprints();
  const retired = [
    previous?.ca && `Remove-Item -ErrorAction SilentlyContinue ${quote(`Cert:\\CurrentUser\\Root\\${previous.ca}`)}`,
    previous?.signing && `Remove-Item -ErrorAction SilentlyContinue ${quote(`Cert:\\CurrentUser\\TrustedPublisher\\${previous.signing}`)}`,
  ].filter(Boolean);
  powershell([
    '$ErrorActionPreference = "Stop"',
    ...retired,
    `Import-Certificate -FilePath ${quote(caCertPath)} -CertStoreLocation Cert:\\CurrentUser\\Root | Out-Null`,
    `Import-Certificate -FilePath ${quote(signingCertPath)} -CertStoreLocation Cert:\\CurrentUser\\TrustedPublisher | Out-Null`,
    `if (-not (Test-Path "Cert:\\CurrentUser\\My\\${signing}")) { throw "Certificat de signature introuvable." }`,
  ].join('; '));
  return true;
}

export async function signApplication(appDir) {
  const { signing } = await readThumbprints();
  const executable = path.join(appDir, `${PRODUCT_NAME}.exe`);
  powershell([
    '$ErrorActionPreference = "Stop"',
    `$certificate = Get-Item "Cert:\\CurrentUser\\My\\${signing}"`,
    `$result = Set-AuthenticodeSignature -FilePath ${quote(executable)} -Certificate $certificate -HashAlgorithm SHA256`,
    'if ($result.Status -ne "Valid") { throw $result.StatusMessage }',
  ].join('; '));
  return SIGNING_COMMON_NAME;
}
