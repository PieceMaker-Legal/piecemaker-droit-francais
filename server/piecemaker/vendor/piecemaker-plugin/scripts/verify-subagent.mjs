#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';

const PM_TIMEOUT_MS = 20000;
const MAX_LINES = 40;

function pmLauncher() {
  return path.join(os.homedir(), '.piecemaker', 'bin', process.platform === 'win32' ? 'pm.cmd' : 'pm');
}

export function runPm(args, cwd, timeoutMs = PM_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(pmLauncher(), args, { cwd, shell: process.platform === 'win32', windowsHide: true });
    } catch (error) {
      resolve({ code: 1, stdout, stderr: error.message });
      return;
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

function unavailable(command, result) {
  const reason = String(result.stderr || result.stdout).trim().split('\n')[0] || `code ${result.code}`;
  return { lines: [`pm ${command} : vérification impossible (${reason}).`], failing: [], incomplete: true };
}

function okfSections(output) {
  const sections = { erreurs: [], contradictions: [], manques: [] };
  let current = null;
  for (const line of String(output).split('\n')) {
    if (line.startsWith('Index OKF')) current = 'erreurs';
    else if (line.startsWith('Contradictions')) current = 'contradictions';
    else if (line.startsWith('Graphe')) current = 'manques';
    else if (line.startsWith('Examinées')) current = null;
    else if (line.startsWith('- ') && current) sections[current].push(line);
  }
  return sections;
}

async function okfCheck(cwd, run, { keepGap, owner, gapOwner = owner }) {
  const result = await run(['okf', 'verify'], cwd);
  if (result.code !== 0 || !result.stdout.includes('Index OKF')) return unavailable('okf verify', result);
  const { erreurs, contradictions, manques } = okfSections(result.stdout);
  const gaps = manques.filter((line) => keepGap(line.slice(2)));
  const lines = [
    `Index OKF : ${erreurs.length} erreur(s).`, ...erreurs,
    ...(contradictions.length ? [`Contradictions à présenter à l'avocat : ${contradictions.length}.`, ...contradictions] : []),
    ...(gaps.length ? [`Manques : ${gaps.length}.`, ...gaps] : []),
  ];
  return { lines, failing: [...(erreurs.length ? [owner] : []), ...(gaps.length ? [gapOwner] : [])] };
}

const DECISION_ID = /\b(JURITEXT\d{12}|[0-9a-f]{24})\b/g;

function decisionsFolder() {
  return path.join(process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'), 'decisions');
}

function researchCheck(report) {
  const cited = [...new Set(String(report).match(DECISION_ID) ?? [])];
  const unread = cited.filter((id) => !fs.existsSync(path.join(decisionsFolder(), `${id}.json`)));
  if (!cited.length) return { lines: ['Aucune décision citée.'], failing: [] };
  return {
    lines: [`Décisions citées : ${cited.length} ; jamais lues par consulter_decision : ${unread.length}.`, ...unread.map((id) => `- ${id}`)],
    failing: unread.length ? ['research-maker'] : [],
  };
}

async function tabularCheck(cwd, run) {
  const result = await run(['tabular_review', 'lister'], cwd);
  let listing;
  try { listing = JSON.parse(String(result.stdout).split('\n')[0]); } catch { listing = null; }
  if (result.code !== 0 || !Array.isArray(listing?.projets)) return unavailable('tabular_review lister', result);
  const drafts = listing.projets.filter((draft) => draft.mode === 'recherche');
  const blocked = drafts.filter((draft) => draft.erreur || draft.a_completer?.length);
  return {
    lines: [
      ...blocked.map((draft) => `- ${draft.projet} ${draft.nom} : ${draft.erreur || `à compléter : ${draft.a_completer.join(', ')}`}`),
      ...drafts.filter((draft) => !blocked.includes(draft)).map((draft) => `- ${draft.projet} ${draft.nom} : téléchargement en cours ou revue non lancée.`),
      ...(drafts.length ? [] : ['Aucune revue en recherche en attente : la revue lancée figure dans les analyses.']),
    ],
    failing: blocked.length ? ['deep-research-maker'] : [],
  };
}

const isPremiseGap = (gap) => gap.includes('(programme ');

const CHECKS = {
  'index-maker': async (cwd, run) => [await okfCheck(cwd, run, { keepGap: () => false, owner: 'index-maker' })],
  'premise-maker': async (cwd, run) => [await okfCheck(cwd, run, { keepGap: isPremiseGap, owner: 'premise-maker' })],
  'research-maker': async (cwd, run, report) => [researchCheck(report)],
  'deep-research-maker': async (cwd, run) => [await tabularCheck(cwd, run)],
};

async function verification(agent, cwd, report, run) {
  const check = CHECKS[agent];
  if (!check || !cwd || !fs.existsSync(path.join(cwd, '.piecemaker'))) return null;
  const results = await check(cwd, run, report);
  const lines = results.flatMap((result) => result.lines);
  if (!lines.length) return null;
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more line(s).`] : lines;
  return { results, shown, owners: [...new Set(results.flatMap((result) => result.failing))] };
}

async function subagentStop(payload, run) {
  const agent = String(payload.agent_type || '');
  const found = await verification(agent, payload.cwd, String(payload.last_assistant_message ?? ''), run);
  if (!found?.owners.length) return null;
  if (payload.stop_hook_active) return { systemMessage: [`The subagent ${agent} ends with errors or gaps:`, ...found.shown].join('\n') };
  return {
    decision: 'block',
    reason: [`Check before the end of the subagent ${agent}:`, ...found.shown, 'Correct these errors or gaps before you give your report. If the documents do not prove a point, report it as missing.'].join('\n'),
  };
}

export async function subagentReport(payload, { run = runPm } = {}) {
  if (payload?.hook_event_name === 'SubagentStop') return subagentStop(payload, run);
  if (!payload || !['Agent', 'Task'].includes(payload.tool_name)) return null;
  const agent = String(payload.tool_input?.subagent_type || '');
  const found = await verification(agent, payload.cwd, JSON.stringify(payload.tool_response ?? ''), run);
  if (!found) return null;
  const { results, shown, owners } = found;
  const verdict = owners.length
    ? [
      `Des erreurs ou manques subsistent. Relancez ${owners.map((owner) => `le sous-agent ${owner}`).join(', puis ')} en lui donnant ces lignes. Ne corrigez pas vous-même.`,
      "Si les mêmes lignes reviennent après une relance, arrêtez et présentez-les à l'avocat.",
    ]
    : results.some((result) => result.incomplete)
      ? ['Vérification incomplète. Lancez-la vous-même avant de conclure.']
      : ['Aucune erreur à corriger.'];
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: [`Vérification après le sous-agent ${agent} :`, ...shown, ...verdict].join('\n'),
    },
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => subagentReport(await readHookPayload(3000)), { timeoutMs: 55000 }).catch(() => noop());
