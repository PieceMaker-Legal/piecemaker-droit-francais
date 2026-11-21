#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';
import { FEATURES, featureOf, pmArgv, verifierArgs, writtenTexts } from './lib/herisson.mjs';
import { runPm } from './verify-subagent.mjs';

const MAX_LINES = 40;

const stateFile = (root) => path.join(process.env.PIECEMAKER_HERISSON_ETAT || path.join(os.tmpdir(), 'piecemaker-herisson'), `${createHash('sha1').update(path.resolve(root)).digest('hex')}.json`);
const readState = (root) => { try { return JSON.parse(fs.readFileSync(stateFile(root), 'utf8')); } catch { return { checks: {} }; } };
const agentsFolder = (root) => stateFile(root).replace(/\.json$/, '.agents');

function writeState(root, state) {
  try {
    if (!state) fs.rmSync(agentsFolder(root), { recursive: true, force: true });
    if (!state || !(Object.keys(state.checks).length || state.blocked)) { fs.rmSync(stateFile(root), { force: true }); return; }
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
const capped = (lines) => (lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more line(s).`] : lines);
const failing = (feature, output) => Boolean(output) && (!feature.erreur || new RegExp(feature.erreur).test(output));
const title = (check) => `Automatic check (${check.feature}): pm ${check.args.join(' ')}`;

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

const FEATURE_TOOL = /^mcp__features__Feature$/;
const OKF_TOOL = 'mcp__features__OkfWrite';

function issuedCommand(payload) {
  const input = payload?.tool_input || {};
  if (payload?.tool_name === 'Bash') return String(Array.isArray(input.command) ? input.command.join(' ') : input.command || '');
  if (payload?.tool_name === OKF_TOOL) {
    return (Array.isArray(input.writes) ? input.writes : []).map(({ action, source, reason, remove, ...link }) => {
      const args = action === 'mark_examined' ? { document: source, reason, remove } : action === 'link_review' ? { premise: source, file: link.file, column: link.column === undefined ? undefined : String(link.column), remove } : { source, ...link };
      try { return `pm ${pmArgv('index', action, args).join(' ')}`; } catch { return ''; }
    }).join('; ');
  }
  if (!FEATURE_TOOL.test(String(payload?.tool_name || '')) || input.action !== 'run') return '';
  try { return `pm ${pmArgv(input.name, input.command, input.args ?? {}).join(' ')}`; } catch { return ''; }
}

export function commandChecks(payload) {
  const command = issuedCommand(payload);
  if (!command) return [];
  const root = payload.cwd || process.cwd();
  if (!fs.existsSync(path.join(root, '.piecemaker'))) return [];
  return FEATURES.filter((feature) => feature.commande && feature.verifier && new RegExp(feature.commande).test(command))
    .flatMap((feature) => (feature.cite ? citingPrograms(root, feature.cite) : ['']).map((nom) => ({ feature, root, nom })));
}

export async function workReport(root, calls, { run = runPm } = {}) {
  const checks = new Map();
  for (const call of calls) {
    const payload = { tool_name: call.tool_name, tool_input: call.tool_input ?? {}, cwd: root };
    const found = touchedFiles(payload).map((file) => featureOf(file)).filter((entry) => entry?.feature.ecriture === 'agent' && entry.feature.verifier);
    for (const entry of [...found, ...commandChecks(payload)]) {
      const args = verifierArgs(entry);
      checks.set(`${entry.root}\0${args.join(' ')}`, { found: entry, args });
    }
  }
  if (!checks.size) return null;
  const sections = [];
  for (const { found, args } of checks.values()) {
    const check = { feature: found.feature.nom, args, root: found.root, delai: found.feature.delai };
    const output = await verified(check, run);
    sections.push(failing(found.feature, output) ? [title(check), ...capped(units(output).join('\n').split('\n'))].join('\n') : `${title(check)}: valid`);
  }
  return [`Rapport hérisson (${checks.size} check(s) on the work of this thread):`, ...sections].join('\n\n');
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
      ...(repeated ? [`${repeated} report item(s) were already shown above and did not change. They are not repeated.${failed ? ' The items that report an error or a gap must still be corrected.' : ''}`] : []),
    ].join('\n'));
  }
  if (!sections.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: [...sections, ...(errors ? ['Correct each error or gap in the file and at the line shown. Do not run this verifier yourself: Le Hérisson runs it after each write and gives the full report at the end of the turn.'] : [])].join('\n\n'),
    },
  };
}

export function subagentTrack(payload) {
  const id = String(payload?.agent_id || '').replace(/[^\w.-]/g, '_');
  if (!id) return null;
  const file = path.join(agentsFolder(payload.cwd || process.cwd()), id);
  try {
    if (payload.hook_event_name !== 'SubagentStart') fs.rmSync(file, { force: true });
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(payload.agent_type || 'subagent')); }
  } catch {}
  return null;
}

function pendingAgents(root) {
  try { return fs.readdirSync(agentsFolder(root)).map((id) => fs.readFileSync(path.join(agentsFolder(root), id), 'utf8')); } catch { return []; }
}

export async function turnEndReport(payload, { run = runPm } = {}) {
  const root = payload?.cwd || process.cwd();
  const state = readState(root);
  const sections = [];
  for (const check of Object.values(state.checks).filter((entry) => entry.failed)) {
    const output = await verified(check, run);
    if (failing(FEATURES.find((feature) => feature.nom === check.feature) ?? {}, output)) sections.push([title(check), ...capped(units(output).join('\n').split('\n'))].join('\n'));
  }
  const agents = pendingAgents(root);
  if ((!sections.length && !agents.length) || state.blocked || payload?.stop_hook_active) { writeState(root, null); return null; }
  writeState(root, { ...state, blocked: true });
  const causes = [
    ...(sections.length ? [`${sections.length} check(s) still report errors or gaps in files that you wrote during this turn`] : []),
    ...(agents.length ? [`${agents.length} PieceMaker subagent(s) started during this turn did not give their report (${agents.join(', ')})`] : []),
  ];
  return {
    decision: 'block',
    reason: [
      `End of turn stopped by Le Hérisson: ${causes.join('; ')}.`,
      ...sections,
      [
        ...(sections.length ? ['Correct each error or gap in the file and at the line shown, then finish. If you cannot correct an item (document missing from the case, decision that belongs to the lawyer), do not correct it: quote it as is to the lawyer in your final answer.'] : []),
        ...(agents.length ? ['Do the work that the lawyer asked for in this turn: wait for each report, or run the subagent again in the foreground and use its report. Do not schedule a wake-up and do not suspend the work. If the lawyer stopped a subagent, do not run it again.'] : []),
        'The end of turn will not be stopped a second time.',
      ].join(' '),
    ].join('\n\n'),
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => {
  const payload = await readHookPayload(3000);
  if (['SubagentStart', 'SubagentStop'].includes(payload?.hook_event_name)) return subagentTrack(payload);
  return payload?.hook_event_name === 'Stop' ? turnEndReport(payload) : featureReport(payload);
}, { timeoutMs: 85000 }).catch(() => noop());
