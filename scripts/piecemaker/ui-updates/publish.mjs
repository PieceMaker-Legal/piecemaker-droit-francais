import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createUiRuntimeConfig } from '../../../desktop-bootstrap/lib/ui-updates.mjs';
import { downloadBytes, verifyManifest } from '../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/package.mjs';

export async function publishUiRelease({ sourceDir, runtimeTag, repository, run = execFileSync, fetcher }) {
  const config = await createUiRuntimeConfig(sourceDir);
  const output = path.join(sourceDir, 'release/ui');
  const envelope = JSON.parse(await fs.readFile(path.join(output, 'ui-update.json'), 'utf8'));
  const manifest = verifyManifest(envelope, config);
  if (runtimeTag !== `v${config.runtime.slice('desktop-'.length)}`) throw new Error('Tag de runtime incompatible.');
  if (config.feed !== `https://github.com/${repository}/releases/download/ui-${config.runtime}`) throw new Error('Dépôt de publication incompatible.');
  const target = execFileSync('git', ['rev-parse', '--verify', `${runtimeTag}^{commit}`], { cwd: sourceDir, encoding: 'utf8' }).trim();
  const tag = `ui-${config.runtime}`;
  const gh = (args) => run('gh', [...args, '--repo', repository], { encoding: 'utf8' });
  const found = run('gh', ['api', '--paginate', `repos/${repository}/releases?per_page=100`, '--jq', `.[] | select(.tag_name == "${tag}")`], { encoding: 'utf8' }).trim();
  const release = found ? JSON.parse(found) : null;
  if (release) {
    if (!release.prerelease || release.draft) throw new Error('Canal interface inattendu.');
    if (release.assets.some((asset) => asset.name === 'ui-update.json')) {
      const current = JSON.parse((await downloadBytes(`${config.feed}/ui-update.json`, 16384, fetcher)).toString());
      if (verifyManifest(current, config).sequence >= manifest.sequence) throw new Error('Une interface plus récente est déjà publiée.');
    }
  } else {
    gh(['release', 'create', tag, '--target', target, '--prerelease', '--latest=false',
      '--title', `Interface PieceMaker ${config.runtime}`, '--notes', 'Interface compatible avec la version complète correspondante. Les dossiers restent en local.']);
  }
  gh(['release', 'upload', tag, path.join(output, manifest.archive), '--clobber']);
  gh(['release', 'upload', tag, path.join(output, 'ui-update.json'), '--clobber']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await publishUiRelease({
    sourceDir: fileURLToPath(new URL('../../../', import.meta.url)),
    runtimeTag: process.env.UI_RUNTIME_TAG,
    repository: process.env.GITHUB_REPOSITORY,
  });
}
