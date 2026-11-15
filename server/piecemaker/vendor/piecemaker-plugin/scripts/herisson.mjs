#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';
import { featureOf, verifierArgs } from './lib/herisson.mjs';
import { runPm } from './verify-subagent.mjs';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const PATCH_FILE = /^\*\*\* (?:Add|Update) File: (.+)$/gm;
const MAX_LINES = 40;

export function touchedFiles(payload) {
  const tool = String(payload?.tool_name || '');
  const input = payload?.tool_input || {};
  const cwd = payload?.cwd || process.cwd();
  if (FILE_TOOLS.has(tool)) {
    const target = input.file_path || input.notebook_path || input.path;
    return target ? [path.resolve(cwd, String(target))] : [];
  }
  if (tool !== 'apply_patch') return [];
  const patch = String(Array.isArray(input.command) ? input.command.join(' ') : input.command || input.patch || input.input || '');
  return [...patch.matchAll(PATCH_FILE)].map((match) => path.resolve(cwd, match[1].trim()));
}

export async function featureReport(payload, { run = runPm } = {}) {
  const checks = new Map();
  for (const file of touchedFiles(payload)) {
    const found = featureOf(file);
    if (found?.feature.ecriture !== 'agent' || !found.feature.verifier) continue;
    const args = verifierArgs(found);
    checks.set(`${found.root}\0${args.join(' ')}`, { found, args });
  }
  const sections = [];
  for (const { found, args } of checks.values()) {
    const result = await run([...args, '--dossier', found.root], found.root, found.feature.delai * 1000);
    const output = String(result.stdout || result.stderr).trim();
    if (!output) continue;
    const lines = output.split('\n');
    const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} ligne(s) de plus.`] : lines;
    sections.push([`Vérification automatique (${found.feature.nom}) : pm ${args.join(' ')}`, ...shown].join('\n'));
  }
  if (!sections.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: [...sections, 'Corrigez les erreurs signalées avant de continuer.'].join('\n\n'),
    },
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => featureReport(await readHookPayload(3000)), { timeoutMs: 85000 }).catch(() => noop());
