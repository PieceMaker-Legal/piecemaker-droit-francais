import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { reconcileClaudeHooks, reconcileCodexHooks, reconcileVibeHooks } from './claude-hooks.js';

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
    assert.ok(groups.some((group) => group.matcher === 'Write|Edit|MultiEdit|NotebookEdit|Bash|Read|Grep|Glob' && group.hooks[0].command.includes('guard-ontologie.mjs')));
    assert.ok(groups.some((group) => group.hooks[0].command === 'echo perso'));
    for (const event of ['SubagentStart', 'SubagentStop']) {
      const tracked = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks[event] as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
      assert.ok(tracked.some((group) => new RegExp(group.matcher).test('research-maker') && group.hooks[0].command.includes('herisson.mjs')));
    }
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
    assert.equal(groups.filter((group) => group.hooks[0].command.includes('guard-ontologie.mjs')).length, 1);
    assert.ok(groups.some((group) => group.hooks[0].command === 'echo perso'));
    const checks = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.SubagentStop as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
    assert.equal(checks.length, 1);
    assert.ok(new RegExp(checks[0].matcher).test('research-maker'));
    assert.ok(checks[0].hooks[0].command.includes('verify-subagent.mjs'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('approves only the PieceMaker hooks in the Codex config, keeping the other entries', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-codex-trust-'));
  try {
    const hooksFile = path.join(home, '.codex', 'hooks.json');
    const configFile = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
    fs.writeFileSync(hooksFile, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo perso' }] }] } }));
    const foreign = `[hooks.state."${hooksFile}:pre_tool_use:0:0"]\nenabled = false\ntrusted_hash = "sha256:perso"\n`;
    const stale = `[hooks.state."${hooksFile}:pre_tool_use:1:0"]\nenabled = true\ntrusted_hash = "sha256:ancien"\n`;
    fs.writeFileSync(configFile, `model = "exemple"\n\n${foreign}\n${stale}`);
    assert.equal((await reconcileCodexHooks(applicationRoot, home)).ok, true);
    const TOML = (await import('@iarna/toml')).default;
    const { codexHookTrustedHash } = await import(path.join(applicationRoot, 'server', 'piecemaker', 'vendor', 'installer', 'lib', 'codex-skills.mjs'));
    const document = JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks;
    const config = fs.readFileSync(configFile, 'utf8');
    const state = (TOML.parse(config) as { hooks: { state: Record<string, { enabled?: boolean; trusted_hash: string }> } }).hooks.state;
    assert.ok(config.includes(foreign));
    assert.deepEqual(state[`${hooksFile}:pre_tool_use:0:0`], { enabled: false, trusted_hash: 'sha256:perso' });
    assert.equal(state[`${hooksFile}:pre_tool_use:1:0`].enabled, true);
    for (const [event, label] of [['PreToolUse', 'pre_tool_use'], ['PostToolUse', 'post_tool_use'], ['SubagentStop', 'subagent_stop'], ['Stop', 'stop']]) {
      document[event].forEach((group: { matcher: string; hooks: Array<{ command: string }> }, index: number) => {
        if (group.hooks[0].command === 'echo perso') return;
        assert.equal(state[`${hooksFile}:${label}:${index}:0`].trusted_hash, codexHookTrustedHash(event, group.matcher, group.hooks[0]));
      });
    }
    assert.equal(Object.keys(state).length, 6);
    const settled = fs.readFileSync(configFile, 'utf8');
    assert.equal((await reconcileCodexHooks(applicationRoot, home)).ok, true);
    assert.equal(fs.readFileSync(configFile, 'utf8'), settled);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('leaves an unreadable Codex config untouched', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-codex-trust-'));
  try {
    const configFile = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, 'model = [\n');
    const result = await reconcileCodexHooks(applicationRoot, home);
    assert.deepEqual(result, { ok: false, reason: 'config-toml-non-modifiable' });
    assert.equal(fs.readFileSync(configFile, 'utf8'), 'model = [\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('installs the PieceMaker hooks in ~/.vibe/hooks.toml only when Vibe is present, keeping personal hooks', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-vibe-hooks-'));
  try {
    assert.deepEqual(await reconcileVibeHooks(applicationRoot, home), { ok: true, skipped: true });
    const file = path.join(home, '.vibe', 'hooks.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[[hooks]]\nname = "perso"\ntype = "post_agent"\ncommand = "echo perso"\n');
    assert.equal((await reconcileVibeHooks(applicationRoot, home)).ok, true);
    const first = fs.readFileSync(file, 'utf8');
    assert.equal((await reconcileVibeHooks(applicationRoot, home)).ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), first);
    const names = [...first.matchAll(/^name = "([^"]+)"/gm)].map((match) => match[1]);
    assert.deepEqual(names, ['perso', 'piecemaker-protect-originals', 'piecemaker-guard-ontologie', 'piecemaker-guard-legal-search', 'piecemaker-guard-secrets', 'piecemaker-classify-ai-documents', 'piecemaker-herisson', 'piecemaker-herisson-fin-de-tour', 'piecemaker-verify-subagent']);
    assert.ok(first.includes('vibe-hook.mjs'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('leaves an unreadable Vibe hooks file untouched', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-vibe-hooks-'));
  try {
    const file = path.join(home, '.vibe', 'hooks.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[[hooks]\nname = ');
    assert.equal((await reconcileVibeHooks(applicationRoot, home)).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '[[hooks]\nname = ');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
