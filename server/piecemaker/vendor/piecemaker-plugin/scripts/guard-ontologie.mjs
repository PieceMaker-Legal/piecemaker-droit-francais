#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';
import { proposalMessage } from './lib/proposition-edit.mjs';
import { FEATURES, featureOf, forbiddenWrite, writtenTexts } from './lib/herisson.mjs';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const KEY_REASON = 'La clé de sceau de l’ontologie (~/.piecemaker/ontologie.cle) n’est accessible qu’au serveur PieceMaker.';
const OKF_REASON = FEATURES.find((feature) => feature.nom === 'okf').motif;
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
  return featureOf(absolute)?.feature.motif || null;
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

function forbiddenReason(tool, input, cwd) {
  for (const { file, text } of writtenTexts(tool, input, cwd)) {
    const found = featureOf(file.normalize('NFC'));
    const reason = found && forbiddenWrite(found, text);
    if (reason) return reason;
  }
  return null;
}

export function ontologyDecision(payload) {
  const tool = String(payload?.tool_name || '');
  const input = payload?.tool_input || {};
  const forbidden = forbiddenReason(tool, input, payload?.cwd);
  if (forbidden) return denial(forbidden);
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
  return denial(guardedReason(`/.piecemaker/${mention[1]}`) || OKF_REASON);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
export async function hookDecision(payload, run) {
  const blocked = ontologyDecision(payload);
  if (blocked?.hookSpecificOutput?.permissionDecisionReason === KEY_REASON) return blocked;
  try {
    const message = await proposalMessage(payload, run);
    if (message) return denial(message);
  } catch (error) {
    return denial(`Proposition non enregistrée, rien n’a changé : ${error?.message || error}.`);
  }
  return blocked;
}

if (isMain) runHook(async () => hookDecision(await readHookPayload(3000)), { timeoutMs: 30000 }).catch(() => noop());
