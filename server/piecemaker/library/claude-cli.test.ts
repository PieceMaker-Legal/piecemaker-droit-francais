import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bundledClaudeExecutable, runClaudeCommand } from './claude-cli.js';

test('bundledClaudeExecutable picks the newest build of the Claude desktop bundle', (t) => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-claude-cli-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  const older = path.join(appData, 'Claude', 'claude-code', '2.1.9', 'aaa111bbb222');
  const newer = path.join(appData, 'Claude', 'claude-code', '2.1.299', 'ccc333ddd444');
  for (const build of [older, newer]) {
    fs.mkdirSync(build, { recursive: true });
    fs.writeFileSync(path.join(build, 'claude.exe'), '');
  }

  assert.equal(bundledClaudeExecutable(appData), path.join(newer, 'claude.exe'));
});

test('bundledClaudeExecutable returns null when the Claude desktop bundle is absent', (t) => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-claude-cli-empty-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));

  assert.equal(bundledClaudeExecutable(appData), null);
  assert.equal(bundledClaudeExecutable(undefined), null);
});

test('runClaudeCommand reports the spawn error instead of an empty failure', () => {
  const result = runClaudeCommand(path.join(os.tmpdir(), 'pm-fictitious-cli-absent'), ['plugin', 'marketplace', 'add', 'acme/plugins']);

  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.output, /ENOENT/);
});
