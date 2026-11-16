#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';
import { proposalMessage } from './lib/proposition-edit.mjs';
import { shellSegments } from './lib/shell-segments.mjs';
import { FEATURES, featureOf, formatErrors } from './lib/herisson.mjs';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const KEY_REASON = 'Only the PieceMaker server can access the seal key of the ontology (~/.piecemaker/ontologie.cle).';
const OKF_REASON = FEATURES.find((feature) => feature.nom === 'okf').motif;
const SHELL_KEY = /\.piecemaker[\\/]ontologie\.cle\b|\bontologie\.cle\b/;
const SHELL_MENTION = /\.piecemaker[\\/]((?:ontologie|arborescence)(?:\.proposition)?\.json|etapes\.json|protection\.json|okf\b)/;
const READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'wc', 'file', 'stat', 'diff', 'sort', 'uniq', 'cut', 'tr', 'jq', 'find', 'echo', 'printf', 'test', 'cd', 'pwd', 'pm', 'true']);
const UNSAFE_ARGUMENT = /(^|\s)(-i\b|--in-place|-delete\b|-exec\b|-execdir\b|-ok\b|-fprint)/;
const SED_PRINT = /^\s*sed\s+-n\s+(['"]?)[\d,$]+p\1(\s|$)/;

const denial = (reason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  systemMessage: reason,
});

const isKey = (absolute) => /(^|[\\/])\.piecemaker[\\/]ontologie\.cle$/.test(absolute);

function resolved(filePath, cwd) {
  return path.resolve(cwd || process.cwd(), String(filePath)).normalize('NFC');
}

function guardedReason(absolute) {
  return featureOf(absolute)?.feature.motif || null;
}

function readOnlyShell(command) {
  const harmless = command.replace(/\d?>&\d/g, '').replace(/\d?>{1,2}\s*\/dev\/null\b/g, '');
  if (/>|`|\$\(|<\(/.test(harmless)) return false;
  return shellSegments(harmless).every((segment) => {
    const words = segment.words.filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    const program = path.basename(words[0] || '');
    return (!words.length || READ_COMMANDS.has(program) || (program === 'sed' && SED_PRINT.test(segment.text))) && (/^([ef]?grep|rg)$/.test(program) || !UNSAFE_ARGUMENT.test(segment.text));
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
  const script = tool === 'Bash' && Array.isArray(input.command) && /^-l?c$/.test(input.command[1]) ? input.command[2] : null;
  const command = String(script ?? (Array.isArray(input.command) ? input.command.join(' ') : input.command || input.patch || input.input || ''));
  if (SHELL_KEY.test(command)) return denial(KEY_REASON);
  const shell = tool === 'Bash' ? shellSegments(command).filter((segment) => !segment.okf).map((segment) => segment.text).join('\n') : command;
  const mention = shell.match(SHELL_MENTION);
  if (!mention || (tool === 'Bash' && readOnlyShell(shell))) return null;
  return denial(guardedReason(`/.piecemaker/${mention[1]}`) || OKF_REASON);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
export async function hookDecision(payload, run) {
  const blocked = ontologyDecision(payload);
  if (blocked?.hookSpecificOutput?.permissionDecisionReason === KEY_REASON) return blocked;
  const refused = await formatErrors(String(payload?.tool_name || ''), payload?.tool_input || {}, payload?.cwd || process.cwd()).catch(() => null);
  if (refused) return denial(refused);
  try {
    const message = await proposalMessage(payload, run);
    if (message) return denial(message);
  } catch (error) {
    return denial(`Proposal not saved, nothing changed: ${error?.message || error}.`);
  }
  return blocked;
}

if (isMain) runHook(async () => hookDecision(await readHookPayload(3000)), { timeoutMs: 30000 }).catch(() => noop());
