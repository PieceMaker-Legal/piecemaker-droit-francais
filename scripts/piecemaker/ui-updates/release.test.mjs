import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertUiOnlyChanges, packUiRelease } from './release.mjs';
import { publishUiRelease } from './publish.mjs';
import { decodeArchive, verifyManifest } from '../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/package.mjs';

async function repository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-ui-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const directory of ['desktop-bootstrap', 'src', 'server', 'dist']) await fs.mkdir(path.join(root, directory));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  await fs.writeFile(path.join(root, 'product.config.json'), JSON.stringify({ repository: 'Example/project' }));
  await fs.writeFile(path.join(root, 'desktop-bootstrap/ui-updates.json'), JSON.stringify({ publicKey: publicPem }));
  await fs.writeFile(path.join(root, 'src/main.ts'), 'original');
  await fs.writeFile(path.join(root, 'server/index.ts'), 'original');
  await fs.writeFile(path.join(root, 'dist/index.html'), '<html>Updated interface</html>');
  git('init', '--quiet');
  git('config', 'user.name', 'Example');
  git('config', 'user.email', 'example@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Initial');
  git('tag', 'v1.0.0');
  return { root, git, privateKey, publicPem };
}

test('publication permits frontend changes and rejects changes to installed runtime', async (t) => {
  const f = await repository(t);
  await fs.writeFile(path.join(f.root, 'src/main.ts'), 'updated');
  assert.equal(assertUiOnlyChanges(f.root, 'v1.0.0'), '1.0.0');
  await fs.writeFile(path.join(f.root, 'server/index.ts'), 'updated');
  assert.throws(() => assertUiOnlyChanges(f.root, 'v1.0.0'), /complète requise.*server/);
  assert.throws(() => assertUiOnlyChanges(f.root, 'main'), /Tag/);
});

test('release packs a platform-independent archive signed for the installed runtime', async (t) => {
  const f = await repository(t);
  const outputDir = path.join(f.root, 'output');
  const result = await packUiRelease({ sourceDir: f.root, distDir: path.join(f.root, 'dist'), outputDir, sequence: 7, privateKey: f.privateKey, runtimeTag: 'v1.0.0' });
  const envelope = JSON.parse(await fs.readFile(path.join(outputDir, 'ui-update.json')));
  const manifest = verifyManifest(envelope, { publicKey: f.publicPem, runtime: 'desktop-1.0.0' });
  const files = decodeArchive(await fs.readFile(path.join(outputDir, result.archive)), manifest);
  assert.match(files.get('index.html').toString(), /Updated interface/);
  assert.equal(result.tag, 'ui-desktop-1.0.0');
  assert.equal(manifest.sequence, 7);
  const wrongKey = generateKeyPairSync('ed25519').privateKey;
  await assert.rejects(packUiRelease({ sourceDir: f.root, distDir: path.join(f.root, 'dist'), outputDir, sequence: 8, privateKey: wrongKey, runtimeTag: 'v1.0.0' }), /clé/);
});

test('publication uploads the archive before the manifest and never becomes the latest complete release', async (t) => {
  const f = await repository(t);
  const outputDir = path.join(f.root, 'release/ui');
  const packed = await packUiRelease({ sourceDir: f.root, distDir: path.join(f.root, 'dist'), outputDir, sequence: 7, privateKey: f.privateKey, runtimeTag: 'v1.0.0' });
  const commands = [];
  const run = (_tool, args) => { commands.push(args); return ''; };
  await publishUiRelease({ sourceDir: f.root, runtimeTag: 'v1.0.0', repository: 'Example/project', run });
  const create = commands.find((args) => args[1] === 'create');
  assert.ok(create.includes('--prerelease'));
  assert.ok(create.includes('--latest=false'));
  const uploads = commands.filter((args) => args[1] === 'upload');
  assert.ok(uploads[0].includes(path.join(outputDir, packed.archive)));
  assert.ok(uploads[1].includes(path.join(outputDir, 'ui-update.json')));
});

test('publication refuses to replace a newer manifest or a complete release', async (t) => {
  const f = await repository(t);
  const outputDir = path.join(f.root, 'release/ui');
  await packUiRelease({ sourceDir: f.root, distDir: path.join(f.root, 'dist'), outputDir, sequence: 7, privateKey: f.privateKey, runtimeTag: 'v1.0.0' });
  const current = await fs.readFile(path.join(outputDir, 'ui-update.json'));
  let complete = false;
  const run = (_tool, args) => {
    assert.equal(args[0], 'api');
    return JSON.stringify({ prerelease: !complete, draft: false, assets: [{ name: 'ui-update.json' }] });
  };
  const options = { sourceDir: f.root, runtimeTag: 'v1.0.0', repository: 'Example/project', run, fetcher: async () => new Response(current) };
  await assert.rejects(publishUiRelease(options), /récente/);
  complete = true;
  await assert.rejects(publishUiRelease(options), /inattendu/);
});
