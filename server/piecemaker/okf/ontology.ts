import fs from 'node:fs';
import path from 'node:path';

import type { ClassificationFolder } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import { DEFAULT_GRAPH_TYPES, readTypes, text } from './bundle.js';
import { normalizeArborescence, ontologyFile, readSealed, sealKey, sealOf, sealedContent } from './sealed.js';

export { normalizeArborescence, ontologyFile };

export type Ontology = { personnalisee: boolean; erreur?: string; arborescence?: ClassificationFolder[] };

const TAMPERED = 'arborescence modifiée hors de l’onglet Case index : enregistrez-la de nouveau dans l’onglet Case index › Classement.';
const TOP_KEYS = ['arborescence', 'motif', 'sceau', 'date'];
const LEGACY_KEYS = ['relations', 'documentTypes'];
const FOLDER_KEYS = ['name', 'explanation', 'type'];
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const failure = (check: () => unknown): string[] => { try { check(); return []; } catch (error) { return [error instanceof Error ? error.message : String(error)]; } };

function arborescenceErrors(list: unknown): string[] {
  if (!Array.isArray(list)) return ['arborescence : donner la liste des dossiers.'];
  const errors = list.flatMap((entry, index) => {
    const where = `dossier ${text(isObject(entry) ? entry.name : '') || index + 1}`;
    if (!isObject(entry)) return [`${where} : donner un objet { ${FOLDER_KEYS.join(', ')} }.`];
    return [
      ...(Object.hasOwn(entry, 'name') ? [] : [`${where} : clé « name » absente.`]),
      ...Object.keys(entry).filter((key) => !FOLDER_KEYS.includes(key)).map((key) => `${where} : clé « ${key} » inconnue (clés admises : ${FOLDER_KEYS.join(', ')}).`),
    ];
  });
  return errors.length ? errors : failure(() => normalizeArborescence(list));
}

export function ontologyErrors(value: unknown, stored = false): string[] {
  if (!isObject(value)) return ['ontologie : donner un objet { "arborescence": [...] }.'];
  const admitted = stored ? [...TOP_KEYS, ...LEGACY_KEYS] : TOP_KEYS;
  const errors = Object.keys(value).filter((key) => !admitted.includes(key)).map((key) => `ontologie : clé « ${key} » inconnue (clés admises : ${TOP_KEYS.join(', ')}). Les classes et relations sont celles de la Legal Ontologies Foundry et ne se modifient pas.`);
  if (value.arborescence === undefined && !stored) errors.push('ontologie : clé « arborescence » absente.');
  if (value.arborescence !== undefined) errors.push(...arborescenceErrors(value.arborescence));
  if (value.motif !== undefined && (typeof value.motif !== 'string' || value.motif.length > 1000)) errors.push('motif : texte de 1000 caractères au plus.');
  return [...new Set(errors)];
}

export function readOntology(_projectPath: string): Ontology {
  try {
    const { stored, tampered } = readSealed();
    if (!stored) return { personnalisee: false };
    const arborescence = stored.arborescence === undefined ? undefined : normalizeArborescence(stored.arborescence);
    if (tampered) return { personnalisee: true, erreur: TAMPERED };
    return { personnalisee: true, ...(arborescence === undefined ? {} : { arborescence }) };
  } catch (error) {
    return { personnalisee: true, erreur: `ontologie illisible : ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function saveOntology(projectPath: string, value: unknown): Ontology {
  const supplied = value as { arborescence?: unknown };
  const arborescence = supplied.arborescence === undefined ? readOntology(projectPath).arborescence : normalizeArborescence(supplied.arborescence);
  const content = arborescence === undefined ? {} : { arborescence };
  const filePath = ontologyFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ ...content, sceau: sealOf(sealKey(true)!, sealedContent(content)) }, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
  return readOntology(projectPath);
}

export function migrateArborescence(projectPaths: string[]): string | null {
  const current = readOntology('');
  if (current.arborescence || current.erreur) return null;
  const legacy = projectPaths
    .map((projectPath) => path.join(projectPath, '.piecemaker', 'arborescence.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const filePath of legacy) {
    try {
      saveOntology('', { arborescence: JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '')) });
      return filePath;
    } catch {}
  }
  return null;
}

export function graphTypesOf(projectPath: string): string[] {
  const present = readTypes(projectPath);
  const types = DEFAULT_GRAPH_TYPES.filter((type) => present.includes(type));
  return types.length ? types : DEFAULT_GRAPH_TYPES;
}
