import fs from 'node:fs/promises';
import path from 'node:path';

export async function createUiRuntimeConfig(sourceDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, 'package.json'), 'utf8'));
  const product = JSON.parse(await fs.readFile(path.join(sourceDir, 'product.config.json'), 'utf8'));
  const { publicKey } = JSON.parse(await fs.readFile(path.join(sourceDir, 'desktop-bootstrap/ui-updates.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)
    || !/^[\w.-]+\/[\w.-]+$/.test(product.repository)) throw new Error('Configuration de livraison invalide.');
  const runtime = `desktop-${manifest.version}`;
  return {
    runtime,
    publicKey,
    feed: `https://github.com/${product.repository}/releases/download/ui-${runtime}`,
  };
}

export async function embedUiRuntimeConfig(sourceDir, stageDir) {
  const config = await createUiRuntimeConfig(sourceDir);
  await fs.writeFile(path.join(stageDir, 'electron-piecemaker/ui-update-runtime.json'), JSON.stringify(config, null, 2));
}
