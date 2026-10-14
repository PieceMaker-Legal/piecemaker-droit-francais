import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('the release stays draft until the Windows package, components and runtime are verified', () => {
  const release = fs.readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const windows = fs.readFileSync(new URL('../../.github/workflows/piecemaker-windows-release.yml', import.meta.url), 'utf8');
  assert.match(release, /--github\.draft/);
  assert.match(release, /needs: release[\s\S]*uses: \.\/\.github\/workflows\/piecemaker-windows-release\.yml/);
  assert.match(windows, /workflow_call:/);
  assert.doesNotMatch(windows, /types: \[published\]/);
  assert.ok(windows.indexOf('verify-packaged-runtime.mjs') < windows.indexOf('name: Attach desktop app to release'));
  assert.ok(windows.indexOf('name: Attach desktop app to release') < windows.indexOf('--draft=false'));
  assert.match(windows, /cp release\/desktop\/.*piecemaker-runtime-components-/);
});
