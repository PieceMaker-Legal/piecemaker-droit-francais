import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packageRuntimeComponents } from './components-package.mjs';
import { assertSafeTarEntries, ensureRuntimeComponents } from '../overlay/electron-piecemaker/runtime-components.mjs';

const writePackage = (root, installedName, version, actualName = installedName) => {
  const directory = path.join(root, 'node_modules', ...installedName.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: actualName, version }));
  fs.writeFileSync(path.join(directory, 'index.js'), `export default ${JSON.stringify(actualName)};\n`);
};

test('packages runtime scopes and installs them once from a verified release archive', async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-runtime-components-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const stage = path.join(work, 'stage');
  const output = path.join(work, 'release');
  writePackage(stage, '@openai/codex-win32-x64', '1.2.3-win32-x64', '@openai/codex');
  writePackage(stage, '@openai/codex-sdk', '4.5.6');
  writePackage(stage, '@anthropic-ai/claude-agent-sdk', '7.8.9');
  writePackage(stage, 'express', '9.0.0');

  const manifest = await packageRuntimeComponents(stage, {
    repository: 'Owner/Repo',
    releaseTag: 'v1.2.3',
    outputDir: output,
    platform: 'win32',
    arch: 'x64',
  });
  assert.equal(manifest.components.length, 1);
  assert.deepEqual(manifest.components[0].packageNames, ['@anthropic-ai/claude-agent-sdk', '@openai/codex-sdk', '@openai/codex-win32-x64']);
  assert.deepEqual(manifest.components[0].packageManifests['@openai/codex-win32-x64'], { name: '@openai/codex', version: '1.2.3-win32-x64' });
  assert.equal(fs.existsSync(path.join(stage, 'node_modules', '@openai')), false);
  assert.equal(fs.existsSync(path.join(stage, 'node_modules', '@anthropic-ai')), false);
  assert.equal(fs.existsSync(path.join(stage, 'node_modules', 'express')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stage, 'runtime-components.json'), 'utf8')), manifest);

  const archive = fs.readFileSync(path.join(output, manifest.components[0].assetName));
  const cacheRoot = path.join(work, 'cache');
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    assert.equal(url, `https://github.com/Owner/Repo/releases/download/v1.2.3/${manifest.components[0].assetName}`);
    return new Response(archive);
  };
  const first = await ensureRuntimeComponents({ manifest, cacheRoot, fetchImpl });
  assert.equal(requests, 1);
  assert.deepEqual(first.moduleRoots, [path.join(cacheRoot, manifest.components[0].id, 'node_modules')]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first.moduleRoots[0], '@openai', 'codex-win32-x64', 'package.json'), 'utf8')), { name: '@openai/codex', version: '1.2.3-win32-x64' });
  const second = await ensureRuntimeComponents({ manifest, cacheRoot, fetchImpl: async () => { throw new Error('unexpected cache download'); } });
  assert.deepEqual(second, first);
  assert.equal(requests, 1);
  const newerRelease = {
    ...manifest,
    releaseTag: 'v1.2.4',
    components: [{ ...manifest.components[0], sha256: 'f'.repeat(64) }],
  };
  const third = await ensureRuntimeComponents({ manifest: newerRelease, cacheRoot, fetchImpl: async () => { throw new Error('same content should reuse cache'); } });
  assert.deepEqual(third, first);
  assert.equal(fs.readdirSync(cacheRoot).some((name) => name.endsWith('.partial')), false);

  const prefetchRoot = path.join(work, 'prefetch-cache');
  const prefetchDir = path.join(work, 'prefetch');
  fs.mkdirSync(prefetchDir);
  fs.copyFileSync(path.join(output, manifest.components[0].assetName), path.join(prefetchDir, manifest.components[0].assetName));
  const prefetched = await ensureRuntimeComponents({
    manifest,
    cacheRoot: prefetchRoot,
    assetDir: prefetchDir,
    fetchImpl: async () => { throw new Error('prefetched archive must not be downloaded'); },
  });
  assert.deepEqual(prefetched.moduleRoots, [path.join(prefetchRoot, manifest.components[0].id, 'node_modules')]);
});

test('failed archive checksum publishes no component cache', async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-runtime-failure-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const stage = path.join(work, 'stage');
  const output = path.join(work, 'release');
  writePackage(stage, '@openai/codex-win32-x64', '1.2.3-win32-x64', '@openai/codex');
  const manifest = await packageRuntimeComponents(stage, {
    repository: 'Owner/Repo', releaseTag: 'v1.2.3', outputDir: output, platform: 'win32', arch: 'x64',
  });
  manifest.components[0].sha256 = '0'.repeat(64);
  const cacheRoot = path.join(work, 'cache');
  await assert.rejects(ensureRuntimeComponents({
    manifest,
    cacheRoot,
    fetchImpl: async () => new Response(fs.readFileSync(path.join(output, manifest.components[0].assetName))),
  }), /checksum mismatch/i);
  assert.equal(fs.existsSync(path.join(cacheRoot, manifest.components[0].id)), false);
  assert.deepEqual(fs.readdirSync(cacheRoot), []);
});

test('rejects absolute and parent traversal archive entries before extraction', () => {
  assertSafeTarEntries('node_modules/@openai/codex/package.json\n', '', ['@openai/codex']);
  assert.throws(() => assertSafeTarEntries('../outside.txt\n'), /Unsafe runtime component archive entry/);
  assert.throws(() => assertSafeTarEntries('C:/outside.txt\n'), /Unsafe runtime component archive entry/);
  assert.throws(() => assertSafeTarEntries('/outside.txt\n'), /Unsafe runtime component archive entry/);
  assert.throws(() => assertSafeTarEntries('node_modules/@openai/unknown/package.json\n', '', ['@openai/codex']), /Unexpected runtime component archive entry/);
  assert.throws(() => assertSafeTarEntries('node_modules/@openai/codex/link\n', 'lrwxrwxrwx 0/0 link -> ../../outside'), /contains a link/);
});
