import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_DOCUMENT_TYPES, DOCUMENT_ICONS } from '../../../plugins/piecemaker-dossier/src/document-types.js';
import type { DocumentType } from '../../../plugins/piecemaker-dossier/src/document-types.js';

import { INVOLVES, MENTIONS, PARTY_TYPE, PREMISE_TYPE, STATES, DEFAULT_GRAPH_TYPES, readTypes, text } from './bundle.js';

export type OntologyRelation = { name: string; label: string; inverse: string; description: string; source: string[]; target: string[] };
export type Ontology = { relations: OntologyRelation[]; personnalisee: boolean; erreur?: string; documentTypes?: DocumentType[] };
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

const home = (): string => process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
export const ontologyFile = (): string => path.join(home(), 'ontologie.json');
const keyFile = (): string => path.join(home(), 'ontologie.cle');
const TAMPERED = 'ontologie modifiée hors de l’onglet Index, ontologie par défaut appliquée : enregistrez-la de nouveau dans l’onglet Index › Ontologie.';

function sealKey(create: boolean): Buffer | null {
  const filePath = keyFile();
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
  if (!create) return null;
  fs.writeFileSync(filePath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  return fs.readFileSync(filePath);
}

const sealOf = (key: Buffer, relations: unknown): string => createHmac('sha256', key).update(JSON.stringify(relations)).digest('hex');

function sealed(key: Buffer | null, relations: unknown, seal: unknown): boolean {
  if (!key || typeof seal !== 'string') return false;
  const expected = Buffer.from(sealOf(key, relations));
  const actual = Buffer.from(seal);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function defaultOntology(): OntologyRelation[] {
  return DEFAULT_RELATIONS.map((relation) => ({ ...relation, source: [...DEFAULT_GRAPH_TYPES], target: [...DEFAULT_GRAPH_TYPES] }));
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

export function normalizeDocumentTypes(value: unknown): DocumentType[] {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('types : donner une liste de 100 types au plus.');
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const name = text(entry?.name).normalize('NFC');
    const icon = text(entry?.icon);
    const where = `type ${name || index + 1}`;
    if (!name || name.length > 120 || RESERVED_TYPES.includes(name)) throw new TypeError(`${where} : nom obligatoire, non réservé (${RESERVED_TYPES.join(', ')}), 120 caractères au plus.`);
    if (seen.has(name.toLocaleLowerCase('fr'))) throw new TypeError(`${where} : nom en double.`);
    if (!Object.hasOwn(DOCUMENT_ICONS, icon)) throw new TypeError(`${where} : icône inconnue « ${icon} » (icônes : ${Object.keys(DOCUMENT_ICONS).join(', ')}).`);
    seen.add(name.toLocaleLowerCase('fr'));
    return { name, icon };
  });
}

const RELATION_KEYS = ['name', 'label', 'inverse', 'description', 'source', 'target'];
const TYPE_KEYS = ['name', 'icon'];
const TOP_KEYS = ['relations', 'documentTypes', 'motif', 'sceau', 'date'];
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const failure = (check: () => unknown): string[] => { try { check(); return []; } catch (error) { return [error instanceof Error ? error.message : String(error)]; } };

function keyErrors(entry: unknown, keys: string[], where: string): string[] {
  if (!isObject(entry)) return [`${where} : donner un objet { ${keys.join(', ')} }.`];
  return [
    ...keys.filter((key) => !Object.hasOwn(entry, key)).map((key) => `${where} : clé « ${key} » absente.`),
    ...Object.keys(entry).filter((key) => !keys.includes(key)).map((key) => `${where} : clé « ${key} » inconnue (clés admises : ${keys.join(', ')}).`),
  ];
}

function listErrors(list: unknown, keys: string[], label: string, normalize: (entries: unknown[]) => unknown): string[] {
  if (!Array.isArray(list)) return [`${label} : donner une liste.`];
  const errors = list.flatMap((entry, index) => {
    const missing = keyErrors(entry, keys, `${label} ${text(isObject(entry) ? entry.name : '') || index + 1}`);
    return missing.length ? missing : failure(() => normalize([entry]));
  });
  return errors.length ? errors : failure(() => normalize(list));
}

export function ontologyErrors(value: unknown): string[] {
  if (!isObject(value)) return ['ontologie : donner un objet { "relations": [...], "documentTypes": [...] }.'];
  const errors = Object.keys(value).filter((key) => !TOP_KEYS.includes(key)).map((key) => `ontologie : clé « ${key} » inconnue (clés admises : ${TOP_KEYS.join(', ')}).`);
  if (value.relations === undefined && value.documentTypes === undefined) errors.push('ontologie : clé « relations » ou « documentTypes » absente.');
  if (value.relations !== undefined) errors.push(...listErrors(value.relations, RELATION_KEYS, 'relation', (relations) => normalizeOntology({ relations })));
  if (value.documentTypes !== undefined) errors.push(...listErrors(value.documentTypes, TYPE_KEYS, 'type', normalizeDocumentTypes));
  if (value.motif !== undefined && (typeof value.motif !== 'string' || value.motif.length > 1000)) errors.push('motif : texte de 1000 caractères au plus.');
  return [...new Set(errors)];
}

export function readOntology(projectPath: string): Ontology {
  const filePath = ontologyFile();
  if (!fs.existsSync(filePath)) return { relations: defaultOntology(), personnalisee: false };
  try {
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
    const relations = normalizeOntology(stored);
    const documentTypes = stored.documentTypes === undefined ? undefined : normalizeDocumentTypes(stored.documentTypes);
    if (!sealed(sealKey(false), documentTypes === undefined ? relations : { relations, documentTypes }, stored?.sceau)) return { relations: defaultOntology(), personnalisee: true, erreur: TAMPERED };
    return { relations, personnalisee: true, ...(documentTypes === undefined ? {} : { documentTypes }) };
  } catch (error) {
    return { relations: defaultOntology(), personnalisee: true, erreur: `ontologie illisible, ontologie par défaut appliquée : ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function saveOntology(projectPath: string, value: unknown): Ontology {
  const relations = normalizeOntology(value);
  const supplied = (value as { documentTypes?: unknown }).documentTypes;
  const documentTypes = normalizeDocumentTypes(supplied === undefined ? readOntology(projectPath).documentTypes || DEFAULT_DOCUMENT_TYPES : supplied);
  const content = { relations, documentTypes };
  const filePath = ontologyFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ ...content, sceau: sealOf(sealKey(true)!, content) }, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
  return readOntology(projectPath);
}

export const relationNames = (ontology: Ontology): string[] => ontology.relations.map((relation) => relation.name);
export const ruleOf = (ontology: Ontology, name: string): OntologyRelation | undefined => ontology.relations.find((relation) => relation.name === name);
export function graphTypesOf(projectPath: string, ontology = readOntology(projectPath)): string[] {
  const present = readTypes(projectPath);
  const types = [...new Set(ontology.relations.flatMap((relation) => [...relation.source, ...relation.target]))].filter((type) => present.includes(type));
  return types.length ? types : DEFAULT_GRAPH_TYPES;
}
export const isSystemRelation = (name: string): boolean => SYSTEM_NAMES.includes(name);
