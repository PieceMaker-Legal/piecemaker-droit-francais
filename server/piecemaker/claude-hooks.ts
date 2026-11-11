import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

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
