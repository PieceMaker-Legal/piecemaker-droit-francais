import { readFileSync, writeFileSync } from 'node:fs';

import { caseOf, readRoadmap, serializeRoadmap } from '../../piecemaker/vendor/piecemaker-plugin/scripts/lib/brain-case.mjs';
import { roadmapErrors } from '../../piecemaker/vendor/piecemaker-plugin/scripts/lib/herisson.mjs';

export const ABOUT_LIMIT = 200;

const invalid = (message: string, code = 400) => Object.assign(new Error(message), { code });
const readText = (file: string) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };

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
  return { folder, name: found.name, about: readText(found.about), roadmap, error, paths: { about: found.about, roadmap: found.roadmap } };
}

export function writeCaseAbout(folder: string, text: unknown) {
  if (typeof text !== 'string') throw invalid('Texte attendu.');
  const lines = text.replace(/\n$/, '').split('\n').length;
  if (lines > ABOUT_LIMIT) throw invalid(`About.md ferait ${lines} lignes : la limite est ${ABOUT_LIMIT}.`);
  const found = target(folder);
  writeFileSync(found.about, text.endsWith('\n') ? text : `${text}\n`);
  return readCasePair(folder);
}

export async function writeCaseRoadmap(folder: string, roadmap: unknown) {
  if (!roadmap || typeof roadmap !== 'object' || Array.isArray(roadmap)) throw invalid('Roadmap.json doit être un objet.');
  const found = target(folder);
  const text = serializeRoadmap(roadmap);
  const known = new Set((roadmapErrors(found.roadmap, readText(found.roadmap)) as Array<{ message: string }>).map((error) => error.message));
  const errors = (roadmapErrors(found.roadmap, text) as Array<{ line: number; message: string }>).filter((error) => !known.has(error.message));
  if (errors.length) throw invalid(errors.map((error) => `ligne ${error.line} : ${error.message}`).join('\n'));
  writeFileSync(found.roadmap, text);
  return readCasePair(folder);
}
