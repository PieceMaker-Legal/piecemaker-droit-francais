#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readHookPayload, runHook, noop } from './lib/hook-io.mjs';

const require = createRequire(import.meta.url);
const { locateProjectCase } = require('./lib/case-folders.cjs');

const CENTRAL_MARKER = path.join('.piecemaker', 'agent-central');
const CENTRAL_SHARED = path.join('.piecemaker', 'orchestrateur', 'fichiers');
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob']);
const MAX_COMMAND_LENGTH = 20_000;

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

export function cloisonnementDecision(payload) {
  const cwd = payload?.cwd || process.cwd();
  const own = locateProjectCase(cwd);
  if (!own) return null;
  for (const target of targets(String(payload?.tool_name || ''), payload?.tool_input || {}, cwd)) {
    const other = locateProjectCase(target);
    if (!other || other.caseRoot === own.caseRoot) continue;
    if (isCentral(other.caseRoot) && inside(path.join(other.caseRoot, CENTRAL_SHARED), other.absolute)) continue;
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
