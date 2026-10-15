import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCertificates, importPublisherCertificate, isCaTrusted, trustCertificateAuthority } from './certificates.mjs';
import { installRuntimeComponents } from '../composants/install.mjs';
import { ensureRuntimeComponents } from '../../electron-piecemaker/runtime-components.mjs';
import { sourceDir, trustMarkerPath, releaseTag } from './paths.mjs';

export async function prepareInstalledDesktop({ applicationRoot = sourceDir, skipCertificateTrust = false, includeProviders = true } = {}) {
  await generateCertificates();
  importPublisherCertificate();
  if (!skipCertificateTrust && !isCaTrusted() && await trustCertificateAuthority()) {
    await fs.writeFile(trustMarkerPath, `${JSON.stringify({ trustedAt: new Date().toISOString(), release: releaseTag })}\n`);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(applicationRoot, 'runtime-components.json'), 'utf8'));
  const cacheRoot = path.join(process.env.LOCALAPPDATA, 'PieceMaker', 'runtime-components');
  await Promise.all([
    ...(includeProviders ? [ensureRuntimeComponents({ manifest, cacheRoot, log: console.log })] : []),
    installRuntimeComponents({ sourceDir: applicationRoot, requirePrebuilt: true }),
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareInstalledDesktop({ skipCertificateTrust: process.argv.includes('--no-certificate') }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
