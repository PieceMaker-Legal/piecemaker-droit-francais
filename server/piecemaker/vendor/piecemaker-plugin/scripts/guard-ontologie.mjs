#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const KEY_REASON = 'La clé de sceau de l’ontologie (~/.piecemaker/ontologie.cle) n’est accessible qu’au serveur PieceMaker.';
const GUARDED = [
  { pattern: /(^|[\\/])\.piecemaker[\\/]ontologie\.json$/, reason: 'L’ontologie des liens (~/.piecemaker/ontologie.json), commune à tous les dossiers, est réglée par l’avocat seul, dans l’onglet Index › Ontologie. Lisez-la avec pm okf ontologie ; proposez un changement avec pm okf ontologie proposer.' },
  { pattern: /(^|[\\/])\.piecemaker[\\/]arborescence\.json$/, reason: 'L’arborescence (.piecemaker/arborescence.json) est réglée par l’avocat seul, dans l’onglet Index › Classement. Proposez un changement avec pm dossier arborescence --dossiers ; l’avocat décide.' },
  { pattern: /(^|[\\/])\.piecemaker[\\/]okf([\\/]|$)/, reason: 'Les fiches OKF (.piecemaker/okf/) sont écrites par le serveur. Posez ou retirez un lien avec pm okf link ou pm okf unlink, dans les relations de l’ontologie (pm okf ontologie).' },
];
const SHELL_KEY = /\.piecemaker[\\/]ontologie\.cle\b|\bontologie\.cle\b/;
const SHELL_MENTION = /\.piecemaker[\\/](ontologie\.json|arborescence\.json|okf\b)/;
const READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'wc', 'file', 'stat', 'diff', 'sort', 'uniq', 'cut', 'tr', 'jq', 'find', 'echo', 'printf', 'test', 'cd', 'pwd', 'pm', 'true']);
const UNSAFE_ARGUMENT = /(^|\s)(-i\b|--in-place|-delete\b|-exec\b|-execdir\b|-ok\b|-fprint)/;

const denial = (reason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  systemMessage: reason,
});

const isKey = (absolute) => /(^|[\\/])\.piecemaker[\\/]ontologie\.cle$/.test(absolute);

function resolved(filePath, cwd) {
  return path.resolve(cwd || process.cwd(), String(filePath)).normalize('NFC');
}

function guardedReason(absolute) {
  return GUARDED.find((entry) => entry.pattern.test(absolute))?.reason || null;
}

function readOnlyShell(command) {
  const harmless = command.replace(/\d?>&\d/g, '').replace(/\d?>{1,2}\s*\/dev\/null\b/g, '');
  if (/>|`|\$\(|<\(/.test(harmless)) return false;
  return harmless.split(/\|\||&&|[|;&\n]/).map((segment) => segment.trim()).filter(Boolean).every((segment) => {
    const words = segment.split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    const program = path.basename(words[0] || '');
    return READ_COMMANDS.has(program) && !UNSAFE_ARGUMENT.test(segment);
  });
}

export function ontologyDecision(payload) {
  const tool = String(payload?.tool_name || '');
  const input = payload?.tool_input || {};
  if (FILE_TOOLS.has(tool) || READ_TOOLS.has(tool)) {
    const target = input.file_path || input.notebook_path || input.path;
    if (!target) return null;
    const absolute = resolved(target, payload.cwd);
    if (isKey(absolute)) return denial(KEY_REASON);
    const reason = FILE_TOOLS.has(tool) ? guardedReason(absolute) : null;
    return reason ? denial(reason) : null;
  }
  if (tool !== 'Bash' && tool !== 'apply_patch') return null;
  const command = String(Array.isArray(input.command) ? input.command.join(' ') : input.command || input.patch || input.input || '');
  if (SHELL_KEY.test(command)) return denial(KEY_REASON);
  const mention = command.match(SHELL_MENTION);
  if (!mention || (tool === 'Bash' && readOnlyShell(command))) return null;
  return denial(guardedReason(`/.piecemaker/${mention[1]}`) || GUARDED[2].reason);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => ontologyDecision(await readHookPayload(3000)), { timeoutMs: 5000 }).catch(() => noop());
