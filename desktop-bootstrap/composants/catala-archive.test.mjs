import assert from 'node:assert/strict';
import test from 'node:test';
import { catalaRecipe } from './catala.mjs';
import { catalaBuildFingerprint, patchZ3MkUtil, pinArchive } from './catala-archive.mjs';

function release() {
  const receipts = {};
  const assets = ['macos', 'windows'].map((platform, index) => {
    const sha256 = String(index + 1).repeat(64);
    receipts[platform] = { platform, sha256, buildFingerprint: catalaBuildFingerprint(), checks: Object.fromEntries(['version', 'typecheck', 'interpret', 'clerkTest', 'python', 'format', 'proof', 'lsp', 'dap'].map((key) => [key, 'ok'])) };
    return { name: `piecemaker-catala-${platform}.tar.gz`, digest: `sha256:${sha256}`, size: 100 };
  });
  return { assets, receipts };
}

test('a release can only pin both tested archives built from this recipe', () => {
  const { assets, receipts } = release();
  assert.equal(pinArchive(catalaRecipe, 'pack-test', assets, receipts).archive.windows.sha256, assets[1].digest.slice(7));
  for (const change of [
    (data) => { delete data.receipts.windows; },
    (data) => { data.receipts.windows.sha256 = 'f'.repeat(64); },
    (data) => { data.receipts.macos.buildFingerprint = 'f'.repeat(64); },
    (data) => { delete data.receipts.windows.checks.proof; },
    (data) => { data.assets.pop(); },
  ]) {
    const data = release();
    change(data);
    assert.throws(() => pinArchive(catalaRecipe, 'pack-test', data.assets, data.receipts));
  }
});

test('Z3 passes MinGW static runtime flags to flexlink through -Wl', () => {
  const line = "            LIBZ3 = LIBZ3 + ' ' + ' '.join(map(lambda x: '-cclib ' + x, LDFLAGS.split()))\n";
  const patched = patchZ3MkUtil(`a\n${line}b\n`);
  assert.match(patched, /'-Wl,' \+ x if x\.startswith\('-static-lib'\) else x/);
  assert.throws(() => patchZ3MkUtil('a\n'), /introuvable/);
  assert.throws(() => patchZ3MkUtil(line + line), /ambiguë/);
});
