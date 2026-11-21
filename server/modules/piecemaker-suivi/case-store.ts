import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { caseOf, readRoadmap, updateRoadmap } from '../../piecemaker/vendor/piecemaker-plugin/scripts/lib/brain-case.mjs';

type Json = Record<string, unknown>;

const LEGACY_ETAPES = path.join('.piecemaker', 'etapes.json');

export function roadmapOf(root: string): string | null {
  return caseOf(root)?.roadmap ?? null;
}

const code = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function brainSuiviFiles(root: string, withDeleted = false): string[] | null {
  const roadmap = roadmapOf(root);
  if (!roadmap) return null;
  const value = readRoadmap(roadmap);
  return [...new Set([...Object.keys(record(value.suivis)), ...(withDeleted ? Object.keys(record(value.suivisSupprimes)) : [])])];
}

export function brainSuiviCode(root: string, fichier: string): string | null | undefined {
  const roadmap = roadmapOf(root);
  if (!roadmap) return undefined;
  const value = record(readRoadmap(roadmap).suivis)[fichier];
  return value === undefined ? null : code(value);
}

export function brainSuiviWrite(root: string, fichier: string, op: 'set' | 'update' | 'delete', change?: (raw: Json | null) => Json): boolean {
  const roadmap = roadmapOf(root);
  if (!roadmap) return false;
  updateRoadmap(roadmap, (value: Json) => {
    const suivis = record(value.suivis);
    const deleted = record(value.suivisSupprimes);
    if (op === 'delete') {
      if (suivis[fichier] === undefined) throw new TypeError(`Aucun suivi ${fichier} pour ce dossier.`);
      deleted[fichier] = suivis[fichier];
      delete suivis[fichier];
    } else {
      if (op === 'set' && suivis[fichier] === undefined && deleted[fichier] !== undefined) {
        suivis[fichier] = deleted[fichier];
        delete deleted[fichier];
      }
      const current = suivis[fichier] === undefined ? null : record(suivis[fichier]);
      if (!current && op !== 'set') throw new TypeError(`Aucun suivi ${fichier} pour ce dossier.`);
      suivis[fichier] = change ? change(current) : current ?? {};
    }
    value.suivis = suivis;
    value.suivisSupprimes = deleted;
  });
  return true;
}

export function brainSuiviCopy(root: string, from: string, to: string): boolean {
  const roadmap = roadmapOf(root);
  if (!roadmap) return false;
  updateRoadmap(roadmap, (value: Json) => {
    const suivis = record(value.suivis);
    if (suivis[to] !== undefined) throw new TypeError(`Le suivi ${to} existe déjà.`);
    if (suivis[from] !== undefined) suivis[to] = structuredClone(suivis[from]);
    value.suivis = suivis;
  });
  return true;
}

export async function readEtapesOf<T>(root: string, fallback: T): Promise<T> {
  const roadmap = roadmapOf(root);
  if (roadmap) {
    try { return (readRoadmap(roadmap).etapes as T | undefined) ?? fallback; } catch { return fallback; }
  }
  try { return JSON.parse(await readFile(path.join(root, LEGACY_ETAPES), 'utf8')) as T; } catch { return fallback; }
}

export async function writeEtapesOf(root: string, etapes: unknown, legacy: (file: string, value: unknown) => Promise<void>) {
  const roadmap = roadmapOf(root);
  if (roadmap) updateRoadmap(roadmap, (value: Json) => { value.etapes = etapes; });
  else await legacy(path.join(root, LEGACY_ETAPES), etapes);
}
