#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';

const RECENT_MS = 2 * 60 * 60 * 1000;
const PM_TIMEOUT_MS = 20000;
const MAX_LINES = 40;

function pmLauncher() {
  return path.join(os.homedir(), '.piecemaker', 'bin', process.platform === 'win32' ? 'pm.cmd' : 'pm');
}

function runPm(args, cwd) {
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
    const timer = setTimeout(() => child.kill(), PM_TIMEOUT_MS);
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
    else if (line.startsWith('- ') && current) sections[current].push(line);
  }
  return sections;
}

async function okfCheck(cwd, run, { command, keepGap, owner, gapOwner = owner }) {
  const result = await run(['okf', command], cwd);
  if (result.code !== 0 || !result.stdout.includes('Index OKF')) return unavailable(`okf ${command}`, result);
  const { erreurs, contradictions, manques } = okfSections(result.stdout);
  const gaps = manques.filter((line) => keepGap(line.slice(2)));
  const lines = [
    `Index OKF : ${erreurs.length} erreur(s).`, ...erreurs,
    ...(contradictions.length ? [`Contradictions à présenter à l'avocat : ${contradictions.length}.`, ...contradictions] : []),
    ...(command === 'verify-graph' ? [`Manques : ${gaps.length}.`, ...gaps] : []),
  ];
  return { lines, failing: [...(erreurs.length ? [owner] : []), ...(gaps.length ? [gapOwner] : [])] };
}

function newestMtime(directory, skipped = new Set()) {
  let newest = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full, skipped) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

function recentReasonings(cwd, now) {
  const directory = path.join(cwd, '.piecemaker', 'raisonnements');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.yaml') && now - fs.statSync(path.join(directory, name)).mtimeMs <= RECENT_MS)
    .map((name) => name.slice(0, -'.yaml'.length));
}

function recentPrograms(cwd, now) {
  const directory = path.join(cwd, '.piecemaker', 'catala');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, changed: newestMtime(path.join(directory, entry.name), new Set(['resultats', '_build'])) }))
    .filter((program) => now - program.changed <= RECENT_MS);
}

async function reasoningCheck(cwd, run, now) {
  const names = recentReasonings(cwd, now);
  if (!names.length) return { lines: [], failing: [] };
  const result = await run(['raisonnement', 'lister'], cwd);
  if (result.code !== 0) return unavailable('raisonnement lister', result);
  const lines = result.stdout.split('\n').filter((line) => names.some((name) => line.startsWith(`${name} — `)));
  const failing = lines.some((line) => /[1-9]\d* erreur|[1-9]\d* manque|non vérifié/.test(line));
  return { lines: lines.map((line) => `Raisonnement ${line}`), failing: failing ? ['reasoning-maker'] : [] };
}

function catalaCheck(cwd, now) {
  const lines = [];
  let failing = false;
  for (const program of recentPrograms(cwd, now)) {
    const report = path.join(cwd, '.piecemaker', 'catala', program.name, 'resultats', 'verification.json');
    let verification = null;
    try { verification = JSON.parse(fs.readFileSync(report, 'utf8')); } catch { verification = null; }
    const verifiedAt = Date.parse(verification?.finished_utc ?? '');
    if (!verification) lines.push(`Catala ${program.name} : jamais vérifié.`);
    else if (!(verifiedAt >= program.changed - 1000)) lines.push(`Catala ${program.name} : modifié après la dernière vérification.`);
    else if (!verification.passed) lines.push(`Catala ${program.name} : à corriger (voir resultats/verification.json).`);
    else { lines.push(`Catala ${program.name} : vérifié.`); continue; }
    failing = true;
  }
  return { lines, failing: failing ? ['reasoning-maker'] : [] };
}

const isPremiseGap = (gap) => gap.startsWith('/_premises/') || gap.includes('#[doc]');
const isDocGap = (gap) => gap.includes('#[doc]');

const CHECKS = {
  'index-maker': async (cwd, run) => [await okfCheck(cwd, run, { command: 'verify', keepGap: () => false, owner: 'index-maker' })],
  'premise-maker': async (cwd, run) => [await okfCheck(cwd, run, { command: 'verify-graph', keepGap: isPremiseGap, owner: 'premise-maker' })],
  'reasoning-maker': async (cwd, run, now) => [
    await reasoningCheck(cwd, run, now),
    catalaCheck(cwd, now),
    await okfCheck(cwd, run, { command: 'verify-graph', keepGap: isDocGap, owner: 'premise-maker', gapOwner: 'premise-maker' }),
  ],
};

export async function subagentReport(payload, { run = runPm, now = Date.now() } = {}) {
  if (!payload || !['Agent', 'Task'].includes(payload.tool_name)) return null;
  const agent = String(payload.tool_input?.subagent_type || '');
  const check = CHECKS[agent];
  const cwd = payload.cwd;
  if (!check || !cwd || !fs.existsSync(path.join(cwd, '.piecemaker'))) return null;
  const results = await check(cwd, run, now);
  const lines = results.flatMap((result) => result.lines);
  if (!lines.length) return null;
  const owners = [...new Set(results.flatMap((result) => result.failing))];
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} ligne(s) de plus.`] : lines;
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
