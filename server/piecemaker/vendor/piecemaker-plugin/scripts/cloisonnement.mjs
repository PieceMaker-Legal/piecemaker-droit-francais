#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readHookPayload, runHook, noop } from './lib/hook-io.mjs';
import { brainRoot as configuredBrain, caseDirectory } from './lib/brain-case.mjs';

const require = createRequire(import.meta.url);
const { locateProjectCase } = require('./lib/case-folders.cjs');

const CENTRAL_MARKER = path.join('.piecemaker', 'agent-central');
const CENTRAL_SHARED = path.join('.piecemaker', 'orchestrateur', 'fichiers');
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob']);
const MAX_COMMAND_LENGTH = 20_000;
const BRAIN_LIMITS = { 'AGENTS.md': 200, 'About.md': 200 };

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWord(word, cwd) {
  const bare = word.replace(/["']/g, '').split(/[*?[{]/)[0];
  if (!bare || bare.startsWith('-')) return null;
  const home = bare === '~' || bare.startsWith('~/') ? path.join(os.homedir(), bare.slice(1)) : bare;
  return path.isAbsolute(home) ? path.resolve(home) : path.resolve(cwd, home);
}

function shellTargets(command, cwd) {
  if (!command || command.length > MAX_COMMAND_LENGTH) return [];
  const words = (command.match(/(?:"[^"]*"|'[^']*'|[^\s;|&<>()"'])+/g) || []).flatMap((word) => {
    const equals = word.indexOf('=');
    return equals > 0 && equals < word.length - 1 ? [word, word.slice(equals + 1)] : [word];
  });
  return words.map((word) => resolveWord(word, cwd)).filter(Boolean);
}

function patchTargets(patch, cwd) {
  return [...String(patch).matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)]
    .map((match) => resolveWord(match[1].trim(), cwd)).filter(Boolean);
}

function targets(tool, input, cwd) {
  if (FILE_TOOLS.has(tool)) {
    const paths = [input.file_path, input.notebook_path, input.path].filter((value) => typeof value === 'string' && value);
    if (typeof input.pattern === 'string' && tool === 'Glob') paths.push(input.pattern);
    return paths.map((value) => resolveWord(value, cwd)).filter(Boolean);
  }
  if (tool === 'apply_patch') return patchTargets(input.command ?? input.patch ?? input.input ?? '', cwd);
  if (tool !== 'Bash') return [];
  const command = input.command;
  const script = Array.isArray(command) ? (/^-l?c$/.test(command[1]) ? command[2] : command.join(' ')) : command;
  return shellTargets(String(script || ''), cwd);
}

function isCentral(caseRoot) {
  return fs.existsSync(path.join(caseRoot, CENTRAL_MARKER));
}

function brainRoot(cwd) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, CENTRAL_MARKER))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

function brainLimit(brain, file) {
  const parts = path.relative(brain, file).split(path.sep);
  if (parts.length === 1 && parts[0] === 'AGENTS.md') return BRAIN_LIMITS['AGENTS.md'];
  if (parts.length === 3 && parts[0] === 'projects' && parts[2] === 'About.md') return BRAIN_LIMITS[parts[2]];
  return null;
}

function replaceText(text, edit) {
  if (typeof edit?.old_string !== 'string' || typeof edit?.new_string !== 'string') return text;
  return edit.replace_all ? text.split(edit.old_string).join(edit.new_string) : text.replace(edit.old_string, () => edit.new_string);
}

function nextText(tool, input, file) {
  if (tool === 'Write') return typeof input.content === 'string' ? input.content : null;
  if (tool !== 'Edit' && tool !== 'MultiEdit') return null;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  return (tool === 'Edit' ? [input] : Array.isArray(input.edits) ? input.edits : []).reduce(replaceText, text);
}

const safeBrain = () => { try { return configuredBrain(); } catch { return null; } };

function ownBrainCase(caseRoot) {
  try { return caseDirectory(caseRoot, { create: false })?.directory ?? null; } catch { return null; }
}

const lineCount = (text) => text.replace(/\n$/, '').split('\n').length;

export function brainLimitDecision(payload) {
  const tool = String(payload?.tool_name || '');
  const input = payload?.tool_input || {};
  if (typeof input.file_path !== 'string') return null;
  const brain = safeBrain() ?? brainRoot(payload?.cwd || process.cwd());
  if (!brain) return null;
  const file = path.resolve(payload?.cwd || process.cwd(), input.file_path);
  const limit = brainLimit(brain, file);
  const text = limit ? nextText(tool, input, file) : null;
  if (text === null || lineCount(text) <= limit) return null;
  const reason = `[PieceMaker] ${path.relative(brain, file)} ferait ${lineCount(text)} lignes : la limite du brain est ${limit}. Condensez avant d’écrire, sans perdre une échéance ni une décision.`;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }, systemMessage: reason };
}

export function cloisonnementDecision(payload) {
  const limited = brainLimitDecision(payload);
  if (limited) return limited;
  const cwd = payload?.cwd || process.cwd();
  const own = locateProjectCase(cwd);
  if (!own) return null;
  for (const target of targets(String(payload?.tool_name || ''), payload?.tool_input || {}, cwd)) {
    const other = locateProjectCase(target);
    if (!other || other.caseRoot === own.caseRoot) continue;
    if (isCentral(other.caseRoot) && inside(path.join(other.caseRoot, CENTRAL_SHARED), other.absolute)) continue;
    const pair = isCentral(other.caseRoot) ? ownBrainCase(own.caseRoot) : null;
    if (pair && inside(pair, target)) continue;
    const reason = `[PieceMaker] Cette session travaille dans le dossier « ${own.caseName} » : l’accès au dossier « ${other.caseName} » est fermé, les dossiers ne se mélangent pas. Pour travailler sur « ${other.caseName} », demandez un fil ouvert dans ce dossier.`;
    return {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
      systemMessage: reason,
    };
  }
  return null;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  runHook(async () => cloisonnementDecision(await readHookPayload(2000)), { timeoutMs: 3000 }).catch(() => noop());
}
