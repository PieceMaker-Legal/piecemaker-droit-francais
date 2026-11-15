#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';
import { FEATURES, featureOf, verifierArgs, writtenTexts } from './lib/herisson.mjs';
import { runPm } from './verify-subagent.mjs';

const MAX_LINES = 40;

export function touchedFiles(payload) {
  return writtenTexts(String(payload?.tool_name || ''), payload?.tool_input || {}, payload?.cwd || process.cwd()).map((entry) => entry.file);
}

function citingPrograms(root, cite) {
  const folder = path.join(root, '.piecemaker', 'catala');
  const names = fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
  return names.filter((name) => fs.readdirSync(path.join(folder, name)).some((file) => file.endsWith('.catala_fr') && fs.readFileSync(path.join(folder, name, file), 'utf8').includes(cite)));
}

export function commandChecks(payload) {
  if (payload?.tool_name !== 'Bash') return [];
  const input = payload.tool_input || {};
  const command = String(Array.isArray(input.command) ? input.command.join(' ') : input.command || '');
  const root = payload.cwd || process.cwd();
  if (!fs.existsSync(path.join(root, '.piecemaker'))) return [];
  return FEATURES.filter((feature) => feature.commande && feature.verifier && new RegExp(feature.commande).test(command))
    .flatMap((feature) => (feature.cite ? citingPrograms(root, feature.cite) : ['']).map((nom) => ({ feature, root, nom })));
}

export async function featureReport(payload, { run = runPm } = {}) {
  const checks = new Map();
  const found = touchedFiles(payload).map((file) => featureOf(file)).filter((entry) => entry?.feature.ecriture === 'agent' && entry.feature.verifier);
  for (const entry of [...found, ...commandChecks(payload)]) {
    const args = verifierArgs(entry);
    checks.set(`${entry.root}\0${args.join(' ')}`, { found: entry, args });
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
