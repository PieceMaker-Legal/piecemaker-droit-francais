import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vendor/piecemaker-plugin/scripts');
const { locateProjectCase } = require(path.join(scripts, 'lib/case-folders.cjs'));
const { isProtectionBypassed } = require(path.join(scripts, 'lib/protection.cjs'));

try {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  const located = locateProjectCase(payload.cwd);
  const protectedCase = Boolean(located?.anonymized) && !isProtectionBypassed(located.caseRoot);
  if (payload.event === 'status') {
    process.stdout.write(JSON.stringify({ registered: Boolean(located), protected: protectedCase }));
  } else {
    const args = payload.args ?? {};
    const tool = { read_file: 'Read', search_files: 'Grep', terminal: 'Bash', write_file: 'Write', patch: 'Read' }[payload.tool];
    if (!tool) throw new Error('Outil de protection inconnu.');
    const target = String(args.path || args.file_path || '.').replace(/^~(?=$|[/\\])/, os.homedir());
    const requested = path.resolve(payload.cwd, target);
    const resolved = fs.existsSync(requested) ? fs.realpathSync(requested) : requested;
    const controls = locateProjectCase(resolved);
    if (['write_file', 'patch'].includes(payload.tool) && controls
      && (resolved === path.join(controls.caseRoot, '.piecemaker') || resolved.startsWith(path.join(controls.caseRoot, '.piecemaker') + path.sep))
      && /(?:^|[/\\])(?:protection(?:-bypass)?\.json|mapping[^/\\]*|[^/\\]*_sensitive_map\.json)$/.test(resolved)) {
      throw new Error('Ce fichier se modifie uniquement dans PieceMaker.');
    }
    const input = { ...args, file_path: target };
    const post = payload.event === 'post';
    const checks = post ? [path.join(scripts, 'classify-ai-documents.mjs')] : [
      path.join(scripts, 'protect-originals.mjs'),
      path.resolve(scripts, '../../installer/assets/claude-hooks/piecemaker-guard-secrets.mjs'),
    ];
    let decision = {};
    for (const script of checks) {
      const child = spawnSync(process.execPath, [script], {
        input: JSON.stringify({ cwd: payload.cwd, tool_name: tool === 'Write' && !post ? 'Read' : tool,
          tool_input: input, tool_response: payload.result, hook_event_name: post ? 'PostToolUse' : 'PreToolUse' }),
        encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
      });
      if (child.error || (child.status !== 0 && child.status !== 2)) throw new Error('Vérification PieceMaker indisponible.');
      const result = child.stdout.trim() ? JSON.parse(child.stdout) : {};
      const verdict = result.hookSpecificOutput;
      if (child.status === 2 || verdict?.permissionDecision === 'deny') {
        decision = { action: 'block', message: verdict?.permissionDecisionReason || child.stderr.trim() || 'Accès refusé.' };
        break;
      }
    }
    process.stdout.write(JSON.stringify(decision));
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ action: 'block', message: error.message }));
}
