import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('the release stays draft until the Windows package, components and runtime are verified', () => {
  const release = fs.readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const windows = fs.readFileSync(new URL('../../.github/workflows/piecemaker-windows-release.yml', import.meta.url), 'utf8');
  assert.match(release, /--github\.draft/);
  assert.match(release, /--npm\.publish=false/);
  assert.match(release, /needs: release[\s\S]*uses: \.\/\.github\/workflows\/piecemaker-windows-release\.yml/);
  assert.match(release, /finalize: false/);
  assert.match(release, /needs: \[release, windows-desktop, gliner-cache\]/);
  assert.match(release, /npm publish --access public/);
  assert.ok(release.indexOf('npm publish --access public') < release.indexOf('gh release edit'));
  assert.match(windows, /workflow_call:/);
  assert.doesNotMatch(windows, /types: \[published\]/);
  assert.ok(windows.indexOf('verify-packaged-runtime.mjs') < windows.indexOf('name: Attach desktop app to release'));
  assert.ok(windows.indexOf('name: Attach desktop app to release') < windows.indexOf('--draft=false'));
  assert.match(windows, /cp release\/desktop\/.*piecemaker-runtime-components-/);
  assert.ok(windows.indexOf('name: Prebuild portable Python components') < windows.indexOf('name: Build desktop app'));
  assert.match(windows, /WINDOWS_CSC_LINK and WINDOWS_CSC_KEY_PASSWORD are required/);
  assert.match(windows, /piecemaker-publisher\.p12/);
  assert.match(windows, /Get-AuthenticodeSignature/);
  assert.match(windows, /test -f .*piecemaker-python-win32-x64\.tar\.gz\.sha256/);
  assert.match(windows, /test -n .*\.exe\.sha256/);
  assert.match(windows, /piecemaker-runtime-components-\*\.tar\.gz\.sha256/);
});
