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

export async function generateCertificates() {
  await fs.mkdir(certsDir, { recursive: true });

  if ((await exists(caCertPath)) && (await exists(thumbprintsPath))) {
    ui.ok('Certificats locaux déjà présents.');
    return { regenerated: false };
  }

  const passphrase = crypto.randomBytes(24).toString('base64url');
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$password = ConvertTo-SecureString -String ${quote(passphrase)} -Force -AsPlainText`,
    '$expiry = (Get-Date).AddDays(825)',
    `$ca = New-SelfSignedCertificate -Subject ${quote(`CN=${CA_COMMON_NAME}, O=${PRODUCT_NAME}`)} -KeyUsage CertSign,CRLSign,DigitalSignature -KeyExportPolicy Exportable -KeyLength 4096 -HashAlgorithm SHA256 -NotAfter $expiry -CertStoreLocation Cert:\\CurrentUser\\My -TextExtension @("2.5.29.19={text}CA=true&pathlength=0")`,
    `$tls = New-SelfSignedCertificate -Subject ${quote('CN=localhost')} -DnsName "localhost","127.0.0.1" -Signer $ca -KeyExportPolicy Exportable -HashAlgorithm SHA256 -NotAfter $expiry -CertStoreLocation Cert:\\CurrentUser\\My -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")`,
    `$signing = New-SelfSignedCertificate -Subject ${quote(`CN=${SIGNING_COMMON_NAME}, O=${PRODUCT_NAME}`)} -Type CodeSigningCert -Signer $ca -KeyExportPolicy Exportable -HashAlgorithm SHA256 -NotAfter $expiry -CertStoreLocation Cert:\\CurrentUser\\My`,
    `Export-Certificate -Cert $ca -FilePath ${quote(caCertPath)} -Type CERT | Out-Null`,
    `Export-Certificate -Cert $tls -FilePath ${quote(tlsCertPath)} -Type CERT | Out-Null`,
    `Export-Certificate -Cert $signing -FilePath ${quote(signingCertPath)} -Type CERT | Out-Null`,
    `Export-PfxCertificate -Cert $tls -FilePath ${quote(tlsBundlePath)} -Password $password | Out-Null`,
    `Export-PfxCertificate -Cert $signing -FilePath ${quote(signingBundlePath)} -Password $password | Out-Null`,
    'ConvertTo-Json @{ ca = $ca.Thumbprint; tls = $tls.Thumbprint; signing = $signing.Thumbprint }',
  ].join('; ');

  const thumbprints = powershell(script);
  await fs.writeFile(thumbprintsPath, thumbprints, 'utf8');
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

  const { signing } = await readThumbprints();
  powershell([
    '$ErrorActionPreference = "Stop"',
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
