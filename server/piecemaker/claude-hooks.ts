import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type HookStatus = { ok: boolean; reason?: string; missing?: Array<{ script: string }>; deprecated?: Array<{ script: string }> };
type ClaudeHooksModule = {
  installClaudeHooks(repoRoot: string, userHome: string): { ok: boolean; reason?: string };
  claudeHooksStatus(repoRoot: string, userHome: string): HookStatus;
};

export function reconcileClaudeHooks(applicationRoot: string, userHome = os.homedir()): HookStatus {
  const vendorRoot = path.join(applicationRoot, 'server', 'piecemaker', 'vendor');
  const hooks = createRequire(import.meta.url)(path.join(vendorRoot, 'websocket-server', 'claude-hooks.cjs')) as ClaudeHooksModule;
  const installed = hooks.installClaudeHooks(vendorRoot, userHome);
  if (!installed.ok) return { ok: false, reason: installed.reason };
  return hooks.claudeHooksStatus(vendorRoot, userHome);
}

type CodexHookResult = { ok: boolean; reason?: string | null };
type CodexHook = (repoRoot: string, userHome: string) => CodexHookResult;
type CodexHooksModule = Record<'installCodexLegalSearchHook' | 'codexLegalSearchHookStatus' | 'installCodexCuaGuardHook' | 'codexCuaGuardHookStatus' | 'installCodexSubagentCheckHook' | 'codexSubagentCheckHookStatus' | 'installCodexOntologyGuardHook' | 'codexOntologyGuardHookStatus' | 'installCodexHerissonHook' | 'codexHerissonHookStatus' | 'installCodexHerissonTurnEndHook' | 'codexHerissonTurnEndHookStatus', CodexHook> & { trustCodexHooks(userHome: string): CodexHookResult };

export async function reconcileCodexHooks(applicationRoot: string, userHome = os.homedir()): Promise<{ ok: boolean; skipped?: boolean; reason?: string | null }> {
  if (!fs.existsSync(path.join(userHome, '.codex'))) return { ok: true, skipped: true };
  const vendorRoot = path.join(applicationRoot, 'server', 'piecemaker', 'vendor');
  const hooks = await import(pathToFileURL(path.join(vendorRoot, 'installer', 'lib', 'codex-skills.mjs')).href) as CodexHooksModule;
  for (const [install, status] of [
    [hooks.installCodexLegalSearchHook, hooks.codexLegalSearchHookStatus],
    [hooks.installCodexCuaGuardHook, hooks.codexCuaGuardHookStatus],
    [hooks.installCodexSubagentCheckHook, hooks.codexSubagentCheckHookStatus],
    [hooks.installCodexOntologyGuardHook, hooks.codexOntologyGuardHookStatus],
    [hooks.installCodexHerissonHook, hooks.codexHerissonHookStatus],
    [hooks.installCodexHerissonTurnEndHook, hooks.codexHerissonTurnEndHookStatus],
  ]) {
    const installed = install(vendorRoot, userHome);
    if (!installed.ok) return installed;
    const checked = status(vendorRoot, userHome);
    if (!checked.ok) return checked;
  }
  const trusted = hooks.trustCodexHooks(userHome);
  if (!trusted.ok) return { ok: false, reason: trusted.reason };
  return { ok: true, reason: null };
}

export async function reconcileVibeHooks(applicationRoot: string, userHome = os.homedir()): Promise<{ ok: boolean; skipped?: boolean; reason?: string | null }> {
  if (!fs.existsSync(path.join(userHome, '.vibe'))) return { ok: true, skipped: true };
  const vendorRoot = path.join(applicationRoot, 'server', 'piecemaker', 'vendor');
  const hooks = await import(pathToFileURL(path.join(vendorRoot, 'installer', 'lib', 'vibe-hooks.mjs')).href) as { installVibeHooks(repoRoot: string, userHome: string): { ok: boolean; reason?: string } };
  const installed = hooks.installVibeHooks(vendorRoot, userHome);
  return { ok: installed.ok, reason: installed.reason ?? null };
}
