import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';
import { ui } from './ui.mjs';

export const MINGIT = {
  version: '2.56.0.2',
  url: 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip',
  sha256: 'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be',
};
export const MINGIT_DIR = 'mingit';

function windowsTar() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

export async function embedMinGit(stageDir, { fetchImpl = fetch, extract = (archive, destination) => run(windowsTar(), ['-xf', archive, '-C', destination]) } = {}) {
  const response = await fetchImpl(MINGIT.url);
  if (!response.ok) throw new Error(`MinGit indisponible (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== MINGIT.sha256) {
    throw new Error('MinGit : empreinte SHA-256 invalide.');
  }
  const destination = path.join(stageDir, MINGIT_DIR);
  const archive = path.join(stageDir, 'mingit.zip');
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(archive, bytes);
  try {
    await extract(archive, destination);
  } finally {
    await fs.rm(archive, { force: true });
  }
  await fs.access(path.join(destination, 'cmd', 'git.exe'));

  const manifestPath = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const extraResources = (manifest.build.extraResources || []).filter((entry) => entry?.to !== MINGIT_DIR);
  manifest.build.extraResources = [...extraResources, { from: MINGIT_DIR, to: MINGIT_DIR }];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  ui.detail(`Git embarqué (MinGit ${MINGIT.version}).`);
}
