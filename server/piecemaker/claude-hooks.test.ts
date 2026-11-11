import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { reconcileClaudeHooks, reconcileCodexHooks } from './claude-hooks.js';

const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));

test('registers the Légifrance search guard in Claude settings and keeps personal hooks', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-claude-hooks-'));
  try {
    const settings = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo perso' }] }] } }));
    const status = reconcileClaudeHooks(applicationRoot, home);
    assert.equal(status.ok, true);
    const groups = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
    assert.ok(groups.some((group) => group.matcher === 'mcp__.*legifrance.*__Search_.*' && group.hooks[0].command.includes('guard-legal-search.mjs')));
    assert.ok(groups.some((group) => group.hooks[0].command === 'echo perso'));
    assert.equal(reconcileClaudeHooks(applicationRoot, home).ok, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('registers the Légifrance search guard and the sub-agent check in Codex hooks only when Codex is present', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-codex-hooks-'));
  try {
    assert.deepEqual(await reconcileCodexHooks(applicationRoot, home), { ok: true, skipped: true });
    assert.equal(fs.existsSync(path.join(home, '.codex', 'hooks.json')), false);
    const file = path.join(home, '.codex', 'hooks.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo perso' }] }] } }));
    assert.equal((await reconcileCodexHooks(applicationRoot, home)).ok, true);
    assert.equal((await reconcileCodexHooks(applicationRoot, home)).ok, true);
    const groups = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
    const guards = groups.filter((group) => group.matcher === 'mcp__.*legifrance.*__Search_.*');
    assert.equal(guards.length, 1);
    assert.ok(guards[0].hooks[0].command.includes('PIECEMAKER_HOOK_CLIENT=codex'));
    assert.ok(groups.some((group) => group.hooks[0].command === 'echo perso'));
    const checks = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.SubagentStop as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
    assert.equal(checks.length, 1);
    assert.ok(new RegExp(checks[0].matcher).test('premise-maker'));
    assert.ok(checks[0].hooks[0].command.includes('verify-subagent.mjs'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
