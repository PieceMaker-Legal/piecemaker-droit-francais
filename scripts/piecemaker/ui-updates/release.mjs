import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPublicKey, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createUiRuntimeConfig } from '../../../desktop-bootstrap/lib/ui-updates.mjs';
import { archiveHash, decodeArchive, MAX_ARCHIVE_BYTES, verifyManifest } from '../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/package.mjs';

export function assertUiOnlyChanges(sourceDir, runtimeTag) {
  if (!/^v\d+\.\d+\.\d+$/.test(runtimeTag)) throw new Error('Tag de version complète requis (vX.Y.Z).');
  const git = (args) => execFileSync('git', args, { cwd: sourceDir, encoding: 'utf8' }).trim();
  git(['merge-base', '--is-ancestor', runtimeTag, 'HEAD']);
  const baseline = JSON.parse(git(['show', `${runtimeTag}:package.json`]));
  const version = JSON.parse(git(['show', 'HEAD:package.json'])).version;
  if (`v${version}` !== runtimeTag || baseline.version !== version) throw new Error('La version du serveur doit rester identique.');
  const changed = git(['diff', '--name-only', runtimeTag, '--']).split('\n').filter(Boolean);
  const forbidden = changed.filter((name) => !/^(?:src\/|public\/|pwa\/|docs\/|index\.html$|vite\.config\.js$|README\.md$)/.test(name));
  if (forbidden.length) throw new Error(`Mise à jour complète requise : ${forbidden.join(', ')}`);
  return version;
}

export async function packUiRelease({ sourceDir, distDir, outputDir, sequence, privateKey, runtimeTag }) {
  assertUiOnlyChanges(sourceDir, runtimeTag);
  const config = await createUiRuntimeConfig(sourceDir);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Séquence positive requise.');
  if (!privateKey) throw new Error('Configurer le secret PIECEMAKER_UI_SIGNING_KEY avant publication.');
  const key = createPublicKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519'
    || key.export({ type: 'spki', format: 'pem' }) !== config.publicKey) {
    throw new Error('La clé de signature ne correspond pas à la clé embarquée.');
  }
  const entries = [];
  async function visit(directory, prefix = '') {
    const children = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const name = prefix + child.name;
      const file = path.join(directory, child.name);
      if (child.isDirectory()) await visit(file, `${name}/`);
      else if (child.isFile()) entries.push([name, (await fs.readFile(file)).toString('base64')]);
      else throw new Error(`Lien ou fichier spécial interdit : ${name}`);
    }
  }
  await visit(distDir);
  const archive = gzipSync(JSON.stringify(entries));
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('Interface trop volumineuse.');
  const sha256 = archiveHash(archive);
  const manifest = { format: 1, runtime: config.runtime, sequence, sha256, archive: `ui-${sha256}.json.gz`, bytes: archive.length };
  decodeArchive(archive, manifest);
  const payload = JSON.stringify(manifest);
  const envelope = { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
  verifyManifest(envelope, config);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, manifest.archive), archive);
  await fs.writeFile(path.join(outputDir, 'ui-update.json'), JSON.stringify(envelope));
  return { tag: `ui-${config.runtime}`, archive: manifest.archive, sequence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const sourceDir = fileURLToPath(new URL('../../../', import.meta.url));
  const runtimeTag = process.env.UI_RUNTIME_TAG;
  if (process.argv[2] === 'check') {
    assertUiOnlyChanges(sourceDir, runtimeTag);
    console.log('Interface compatible avec la version complète.');
  } else if (process.argv[2] === 'pack') {
    const result = await packUiRelease({
      sourceDir,
      distDir: path.join(sourceDir, 'dist'),
      outputDir: path.join(sourceDir, 'release', 'ui'),
      sequence: Number(process.env.GITHUB_RUN_ID),
      privateKey: process.env.PIECEMAKER_UI_SIGNING_KEY,
      runtimeTag,
    });
    console.log(JSON.stringify(result));
  } else {
    throw new Error('Commande attendue : check ou pack.');
  }
}
