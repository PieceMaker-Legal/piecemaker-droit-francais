#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const GUARDED = [
  { pattern: /(^|[\\/])\.piecemaker[\\/]ontologie\.json$/, reason: 'L’ontologie des liens (.piecemaker/ontologie.json) est réglée par l’avocat seul, dans l’onglet Index › Ontologie. Lisez-la avec pm okf ontologie.' },
  { pattern: /(^|[\\/])\.piecemaker[\\/]arborescence\.json$/, reason: 'L’arborescence (.piecemaker/arborescence.json) se modifie avec pm dossier arborescence : ses dossiers de premier niveau, les types de documents, restent réservés à l’avocat.' },
  { pattern: /(^|[\\/])\.piecemaker[\\/]okf([\\/]|$)/, reason: 'Les fiches OKF (.piecemaker/okf/) sont écrites par le serveur. Posez ou retirez un lien avec pm okf link ou pm okf unlink, dans les relations de l’ontologie (pm okf ontologie).' },
];
const SHELL_MENTION = /\.piecemaker[\\/](ontologie\.json|arborescence\.json|okf\b)/;
const SHELL_WRITE = /(^|[^0-9&>])>{1,2}(?!&)|\b(tee|mv|cp|rm|rmdir|touch|truncate|dd|ln|install|rsync|unlink|python3?|node|perl|ruby|osascript|jq\s+-i|sed\s+-i|patch|git\s+(checkout|restore|apply|reset|stash))\b/;

const denial = (reason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  systemMessage: reason,
});

function guardedReason(filePath, cwd) {
  const absolute = path.resolve(cwd || process.cwd(), String(filePath)).normalize('NFC');
  return GUARDED.find((entry) => entry.pattern.test(absolute))?.reason || null;
}

export function ontologyDecision(payload) {
  const tool = String(payload?.tool_name || '');
  const input = payload?.tool_input || {};
  if (FILE_TOOLS.has(tool)) {
    const target = input.file_path || input.notebook_path;
    const reason = target ? guardedReason(target, payload.cwd) : null;
    return reason ? denial(reason) : null;
  }
  if (tool !== 'Bash' && tool !== 'apply_patch') return null;
  const command = String(input.command || input.patch || input.input || '');
  const mention = command.match(SHELL_MENTION);
  if (!mention || (tool === 'Bash' && !SHELL_WRITE.test(command))) return null;
  return denial(guardedReason(`.piecemaker/${mention[1]}`, '/') || GUARDED[2].reason);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => ontologyDecision(await readHookPayload(3000)), { timeoutMs: 5000 }).catch(() => noop());
