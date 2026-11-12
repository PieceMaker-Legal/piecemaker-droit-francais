import fs from 'node:fs';
import path from 'node:path';

import { INVOLVES, MENTIONS, PARTY_TYPE, PREMISE_TYPE, STATES, readGraphTypes, readTypes, text } from './bundle.js';

export type OntologyRelation = { name: string; label: string; inverse: string; description: string; source: string[]; target: string[] };
export type Ontology = { relations: OntologyRelation[]; personnalisee: boolean; erreur?: string };
export type SystemRelation = { name: string; label: string; inverse: string; description: string; source: string; target: string };

export const SYSTEM_RELATIONS: SystemRelation[] = [
  { name: STATES, label: 'établit', inverse: 'établi par', description: 'Une pièce établit une prémisse (fait ou clause) par une citation.', source: 'document', target: PREMISE_TYPE },
  { name: MENTIONS, label: 'mentionne', inverse: 'mentionné par', description: 'Une pièce mentionne une partie. Posé par l’analyse du dossier.', source: 'document', target: PARTY_TYPE },
  { name: INVOLVES, label: 'concerne', inverse: 'concerné par', description: 'Une prémisse concerne une partie.', source: PREMISE_TYPE, target: PARTY_TYPE },
];
const SYSTEM_NAMES = SYSTEM_RELATIONS.map((relation) => relation.name);
const RESERVED_TYPES = [PREMISE_TYPE, PARTY_TYPE];
const NAME = /^[a-z][a-z0-9-]{0,39}$/;

const DEFAULT_RELATIONS: Array<Omit<OntologyRelation, 'source' | 'target'>> = [
  { name: 'amends', label: 'modifie', inverse: 'modifié par', description: 'Un document modifie un autre document (avenant, rectificatif).' },
  { name: 'responds-to', label: 'répond à', inverse: 'répondu par', description: 'Un document répond à un autre document (réponse à un courrier, conclusions en réponse).' },
  { name: 'refers-to', label: 'se réfère à', inverse: 'visé par', description: 'Un document cite ou vise un autre document.' },
  { name: 'supersedes', label: 'remplace', inverse: 'remplacé par', description: 'Un document remplace un autre document (nouvelle version).' },
];

export const ontologyFile = (projectPath: string): string => path.join(projectPath, '.piecemaker', 'ontologie.json');

export function defaultOntology(projectPath: string): OntologyRelation[] {
  const graphTypes = readGraphTypes(projectPath);
  return DEFAULT_RELATIONS.map((relation) => ({ ...relation, source: [...graphTypes], target: [...graphTypes] }));
}

function typeList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${where} : donner une liste de types de documents.`);
  const types = [...new Set(value.map((entry) => text(entry).normalize('NFC')).filter(Boolean))];
  if (!types.length) throw new TypeError(`${where} : au moins un type de document.`);
  for (const type of types) if (RESERVED_TYPES.includes(type)) throw new TypeError(`${where} : « ${type} » est un type réservé.`);
  return types;
}

export function normalizeOntology(value: unknown): OntologyRelation[] {
  const relations = (value && typeof value === 'object' && !Array.isArray(value) ? (value as { relations?: unknown }).relations : undefined);
  if (!Array.isArray(relations)) throw new TypeError('ontologie : donner { "relations": [...] }.');
  const seen = new Set<string>();
  return relations.map((entry, index) => {
    const relation = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const name = text(relation.name);
    const where = `relation ${name || index + 1}`;
    if (!NAME.test(name)) throw new TypeError(`${where} : nom en minuscules, chiffres et tirets, 40 caractères au plus.`);
    if (SYSTEM_NAMES.includes(name)) throw new TypeError(`${where} : « ${name} » est une relation système.`);
    if (seen.has(name)) throw new TypeError(`${where} : nom en double.`);
    seen.add(name);
    const label = text(relation.label);
    if (!label || label.length > 60) throw new TypeError(`${where} : libellé obligatoire, 60 caractères au plus.`);
    const inverse = text(relation.inverse) || label;
    const description = text(relation.description);
    if (inverse.length > 60 || description.length > 500) throw new TypeError(`${where} : libellé inverse de 60 caractères et description de 500 caractères au plus.`);
    return { name, label, inverse, description, source: typeList(relation.source, `${where}, source`), target: typeList(relation.target, `${where}, cible`) };
  });
}

export function readOntology(projectPath: string): Ontology {
  const filePath = ontologyFile(projectPath);
  if (!fs.existsSync(filePath)) return { relations: defaultOntology(projectPath), personnalisee: false };
  try {
    return { relations: normalizeOntology(JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''))), personnalisee: true };
  } catch (error) {
    return { relations: defaultOntology(projectPath), personnalisee: true, erreur: `ontologie illisible, ontologie par défaut appliquée : ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function missingTypes(projectPath: string, relations: OntologyRelation[]): string[] {
  const types = readTypes(projectPath);
  return [...new Set(relations.flatMap((relation) => [...relation.source, ...relation.target]))].filter((type) => !types.includes(type));
}

export function saveOntology(projectPath: string, value: unknown): Ontology {
  const relations = normalizeOntology(value);
  const missing = missingTypes(projectPath, relations);
  if (missing.length) throw new TypeError(`types absents de l'arborescence : ${missing.join(', ')}. Types : ${readTypes(projectPath).join(', ')}.`);
  const filePath = ontologyFile(projectPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ relations }, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
  return readOntology(projectPath);
}

export const relationNames = (ontology: Ontology): string[] => ontology.relations.map((relation) => relation.name);
export const ruleOf = (ontology: Ontology, name: string): OntologyRelation | undefined => ontology.relations.find((relation) => relation.name === name);
export function graphTypesOf(projectPath: string, ontology = readOntology(projectPath)): string[] {
  const types = [...new Set(ontology.relations.flatMap((relation) => [...relation.source, ...relation.target]))];
  return types.length ? types : readGraphTypes(projectPath);
}
export const isSystemRelation = (name: string): boolean => SYSTEM_NAMES.includes(name);
