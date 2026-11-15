#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';
import { FEATURES, featureOf, verifierArgs, writtenTexts } from './lib/herisson.mjs';
import { runPm } from './verify-subagent.mjs';

const MAX_LINES = 40;

const stateFile = (root) => path.join(process.env.PIECEMAKER_HERISSON_ETAT || path.join(os.tmpdir(), 'piecemaker-herisson'), `${createHash('sha1').update(path.resolve(root)).digest('hex')}.json`);
const readState = (root) => { try { return JSON.parse(fs.readFileSync(stateFile(root), 'utf8')); } catch { return { checks: {} }; } };

function writeState(root, state) {
  try {
    if (!state || !Object.keys(state.checks).length) { fs.rmSync(stateFile(root), { force: true }); return; }
    fs.mkdirSync(path.dirname(stateFile(root)), { recursive: true });
    fs.writeFileSync(stateFile(root), JSON.stringify(state));
  } catch {}
}

function units(output) {
  const list = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) && list.length) list[list.length - 1] += `\n${line}`;
    else list.push(line);
  }
  return list;
}

const unplaced = (unit) => unit.replace(/^(\p{L}+) \d+ —/u, '$1 —').replace(/(:|\bligne )\d+/g, '$1');
const capped = (lines) => (lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} ligne(s) de plus.`] : lines);
const failing = (feature, output) => Boolean(output) && (!feature.erreur || new RegExp(feature.erreur).test(output));
const title = (check) => `Vérification automatique (${check.feature}) : pm ${check.args.join(' ')}`;

async function verified(check, run) {
  const result = await run([...check.args, '--dossier', check.root], check.root, check.delai * 1000);
  return String(result.stdout || result.stderr).trim();
}

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
  let errors = false;
  for (const { found, args } of checks.values()) {
    const check = { feature: found.feature.nom, args, root: found.root, delai: found.feature.delai };
    const output = await verified(check, run);
    const state = readState(found.root);
    const key = args.join(' ');
    const known = (state.checks[key]?.units ?? []).map(unplaced);
    const all = units(output);
    const fresh = all.filter((unit) => {
      const at = known.indexOf(unplaced(unit));
      if (at >= 0) known.splice(at, 1);
      return at < 0;
    });
    const failed = failing(found.feature, output);
    if (all.length) state.checks[key] = { ...check, units: all, failed };
    else delete state.checks[key];
    writeState(found.root, state);
    if (!fresh.length) continue;
    errors ||= failed;
    const repeated = all.length - fresh.length;
    sections.push([
      title(check),
      ...capped(fresh.join('\n').split('\n')),
      ...(repeated ? [`${repeated} élément(s) du rapport, déjà rendu(s) plus haut et inchangé(s), ne sont pas répétés.${failed ? ' Ceux qui signalent une erreur ou un manque restent à corriger.' : ''}`] : []),
    ].join('\n'));
  }
  if (!sections.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: [...sections, ...(errors ? ['Corrigez chaque erreur ou manque dans le fichier et à la ligne indiqués. Ne relancez pas ce vérificateur : le Hérisson le relance après chaque écriture et rend le rapport complet en fin de tour.'] : [])].join('\n\n'),
    },
  };
}

export async function turnEndReport(payload, { run = runPm } = {}) {
  const root = payload?.cwd || process.cwd();
  const state = readState(root);
  const sections = [];
  for (const check of Object.values(state.checks).filter((entry) => entry.failed)) {
    const output = await verified(check, run);
    if (failing(FEATURES.find((feature) => feature.nom === check.feature) ?? {}, output)) sections.push([title(check), ...capped(units(output).join('\n').split('\n'))].join('\n'));
  }
  if (!sections.length || state.blocked || payload?.stop_hook_active) { writeState(root, null); return null; }
  writeState(root, { ...state, blocked: true });
  return {
    decision: 'block',
    reason: [
      `Fin de tour suspendue par le Hérisson : ${sections.length} vérification(s) signalent encore des erreurs ou des manques dans des fichiers que vous avez écrits pendant ce tour.`,
      ...sections,
      'Corrigez chaque erreur ou manque dans le fichier et à la ligne indiqués, puis terminez. Si un point ne peut pas être corrigé (pièce absente du dossier, décision qui revient à l’avocat), ne le corrigez pas : citez-le tel quel à l’avocat dans votre réponse finale. La fin de tour ne sera pas suspendue une seconde fois.',
    ].join('\n\n'),
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => {
  const payload = await readHookPayload(3000);
  return payload?.hook_event_name === 'Stop' ? turnEndReport(payload) : featureReport(payload);
}, { timeoutMs: 85000 }).catch(() => noop());
