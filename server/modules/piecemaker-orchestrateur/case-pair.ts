import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { caseOf, goalFile, goalNames, goalOfSuivi, readRoadmap, serializeRoadmap, writeRoadmap, GOAL_TIMELINE_KEYS, ROADMAP } from '../../piecemaker/vendor/piecemaker-plugin/scripts/lib/brain-case.mjs';
import { goalErrors, timelineErrors } from '../../piecemaker/vendor/piecemaker-plugin/scripts/lib/herisson.mjs';

export const ABOUT_LIMIT = 200;
const GOAL_TEXTS: Record<string, keyof Goal> = { 'Goal.md': 'goal', 'Memory.md': 'memory', 'Archive.md': 'archive' };
const GOAL_NAME = /^[^./\\][^/\\]*$/;

type Goal = { name: string; goal: string; memory: string; archive: string };
type Errors = Array<{ line: number; message: string }>;

const invalid = (message: string, code = 400) => Object.assign(new Error(message), { code });
const readText = (file: string) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const report = (errors: Errors) => errors.map((error) => `ligne ${error.line} : ${error.message}`).join('\n');

function target(folder: string) {
  const found = caseOf(folder);
  if (!found) throw invalid('Aucun brain configuré : choisissez son emplacement dans Paramètres › Brain.', 409);
  return found;
}

export function readCasePair(folder: string) {
  const found = target(folder);
  let roadmap: Record<string, unknown> = {};
  let error: string | null = null;
  try { roadmap = readRoadmap(found.roadmap); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const goals: Goal[] = goalNames(found.directory).map((name: string) => ({
    name, goal: readText(goalFile(found.directory, name, 'Goal.md')), memory: readText(goalFile(found.directory, name, 'Memory.md')), archive: readText(goalFile(found.directory, name, 'Archive.md')),
  }));
  return { folder, name: found.name, about: readText(found.about), roadmap, goals, error, paths: { about: found.about, roadmap: found.roadmap, goals: found.goals } };
}

export function writeCaseAbout(folder: string, text: unknown) {
  if (typeof text !== 'string') throw invalid('Texte attendu.');
  const lines = text.replace(/\n$/, '').split('\n').length;
  if (lines > ABOUT_LIMIT) throw invalid(`About.md ferait ${lines} lignes : la limite est ${ABOUT_LIMIT}.`);
  const found = target(folder);
  writeFileSync(found.about, text.endsWith('\n') ? text : `${text}\n`);
  return readCasePair(folder);
}

export function writeCaseGoal(folder: string, goal: unknown, file: unknown, text: unknown) {
  if (typeof goal !== 'string' || !GOAL_NAME.test(goal.trim())) throw invalid('Nom de goal invalide.');
  if (typeof file !== 'string' || !GOAL_TEXTS[file]) throw invalid('Fichier attendu : Goal.md, Memory.md ou Archive.md.');
  if (typeof text !== 'string') throw invalid('Texte attendu.');
  const content = text.endsWith('\n') ? text : `${text}\n`;
  const found = target(folder);
  const destination = goalFile(found.directory, goal.trim(), file);
  const errors = file === 'Archive.md' ? [] : goalErrors(destination, content) as Errors;
  if (errors.length) throw invalid(report(errors));
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
  return readCasePair(folder);
}

export async function writeCaseRoadmap(folder: string, roadmap: unknown) {
  if (!roadmap || typeof roadmap !== 'object' || Array.isArray(roadmap)) throw invalid('Timeline.json doit être un objet.');
  const found = target(folder);
  const current = readRoadmap(found.roadmap);
  const { suivis = {}, ...rest } = roadmap as Record<string, unknown>;
  const { suivis: _suivis, ...kept } = current;
  for (const key of new Set([...Object.keys(rest), ...Object.keys(kept)])) {
    if (JSON.stringify(rest[key] ?? null) !== JSON.stringify(kept[key] ?? null)) throw invalid(`ligne 1 : "${key}" cannot be changed here: only the goals' échéances, événements and matter can.`);
  }
  if (!suivis || typeof suivis !== 'object' || Array.isArray(suivis)) throw invalid('"suivis" doit être un objet.');
  const owned: Record<string, Record<string, unknown>> = {};
  for (const goal of goalNames(found.directory)) {
    try { owned[goal] = JSON.parse(readText(goalFile(found.directory, goal, ROADMAP)) || '{}').actes ?? {}; } catch { owned[goal] = {}; }
  }
  for (const [fichier, suivi] of Object.entries(suivis as Record<string, Record<string, unknown>>)) {
    const goal = goalOfSuivi(fichier);
    if (!GOAL_NAME.test(goal)) throw invalid(`Nom de suivi invalide : ${fichier}.`);
    const text = serializeRoadmap({ actes: owned[goal] ?? {}, ...suivi }, GOAL_TIMELINE_KEYS);
    const errors = timelineErrors(goalFile(found.directory, goal, ROADMAP), text) as Errors;
    if (errors.length) throw invalid(`${goal} : ${report(errors)}`);
  }
  writeRoadmap(found.roadmap, { ...current, suivis });
  return readCasePair(folder);
}
