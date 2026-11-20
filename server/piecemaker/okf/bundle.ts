import fs from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { readArborescence } from './sealed.js';

export const OKF_VERSION = '0.2';
export const STATES = 'states';
export const MENTIONS = 'mentions';
export const INVOLVES = 'involves';
export const SCAN_ACTOR = 'piecemaker/gliner';
export const AGENT_ACTOR = 'piecemaker/agent';
export const LAWYER_ACTOR = 'piecemaker/avocat';
export const DERIVED_ACTORS = [SCAN_ACTOR];
export const PREMISE_TYPE = 'Premise';
export const PARTY_TYPE = 'Partie';
const PREMISE_FOLDER = '/_premises/';
const LEGACY_PREMISE_FOLDER = '/_faits/';
const PARTY_FOLDER = '/_parties/';
export const UNCLASSIFIED = 'Non classé';
export const DEFAULT_GRAPH_TYPES = ['Pièces'];
const RESERVED = new Set(['index.md', 'log.md']);

export type Frontmatter = Record<string, unknown>;
export type Relation = { target: string; citation: string; origin: string; value?: string; at?: string; dismissed?: boolean };
export type Relations = Record<string, Relation[]>;
export type Concept = { id: string; frontmatter: Frontmatter; body: string; error?: string };

const posix = (value: string): string => value.split(path.sep).join('/').normalize('NFC');

export const bundleRoot = (projectPath: string): string => path.join(projectPath, '.piecemaker', 'okf');
export const conceptId = (resource: string): string => `/${posix(resource)}.md`;
export const conceptFile = (projectPath: string, id: string): string => path.join(bundleRoot(projectPath), ...id.slice(1).split('/'));
export const resourceOf = (projectPath: string, filePath: string): string => posix(path.relative(projectPath, filePath));
export const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();
export const typographic = (value: string): string => squash(value.replace(/[\u2018\u2019\u02BC\u2032]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u00A0\u202F]/g, ' '));
export const fold = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
export const migratedId = (id: string): string => id.startsWith(LEGACY_PREMISE_FOLDER) ? `${PREMISE_FOLDER}${id.slice(LEGACY_PREMISE_FOLDER.length)}` : id;
export const isPremiseId = (id: string): boolean => id.startsWith(PREMISE_FOLDER);
export const isPartyId = (id: string): boolean => id.startsWith(PARTY_FOLDER);
export const partyId = (code: string): string => isPartyId(code) ? code : `${PARTY_FOLDER}${code}.md`;

export function premiseId(title: string): string {
  if (isPremiseId(title)) return title;
  const slug = fold(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new TypeError('prémisse sans titre.');
  return `${PREMISE_FOLDER}${slug}.md`;
}

export function parseConcept(source: string): { frontmatter: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source.replace(/^﻿/, ''));
  if (!match) throw new Error('frontmatter YAML absent');
  const frontmatter = parse(match[1]) as unknown;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) throw new Error('frontmatter YAML illisible');
  return { frontmatter: frontmatter as Frontmatter, body: match[2] };
}

export function serializeConcept(frontmatter: Frontmatter, body: string): string {
  return `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${body ? `\n${body.trim()}\n` : ''}`;
}

export function relationsOf(frontmatter: Frontmatter): Relations {
  const source = frontmatter.relations;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const relations: Relations = {};
  for (const [name, entries] of Object.entries(source as Record<string, unknown>)) {
    relations[name] = (Array.isArray(entries) ? entries : []).map((entry) => {
      const value = (entry && typeof entry === 'object' ? entry : { target: entry }) as Record<string, unknown>;
      return { target: text(value.target), citation: text(value.citation), origin: text(value.origin), ...(text(value.value) ? { value: text(value.value) } : {}), ...(text(value.at) ? { at: text(value.at) } : {}), ...(value.dismissed === true ? { dismissed: true } : {}) };
    });
  }
  return relations;
}

function conceptFiles(directory: string, prefix = ''): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}/${entry.name.normalize('NFC')}`;
    if (entry.isDirectory()) return conceptFiles(path.join(directory, entry.name), relative);
    return entry.isFile() && entry.name.endsWith('.md') && !RESERVED.has(entry.name) ? [relative] : [];
  });
}

export function readBundle(projectPath: string): Concept[] {
  return conceptFiles(bundleRoot(projectPath)).sort().map((id) => {
    try {
      return { id, ...parseConcept(fs.readFileSync(conceptFile(projectPath, id), 'utf8')) };
    } catch (error) {
      return { id, frontmatter: {}, body: '', error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** Types principaux, communs à tous les dossiers : ceux de l'arborescence de l'ontologie. */
export function readTypes(_projectPath?: string): string[] {
  const folders = readArborescence();
  return [...new Set(folders.map((folder) => folderType(`${text(folder.name)}/_`, folders)).filter(Boolean))];
}

function folderType(resource: string, folders: Array<{ name?: unknown; type?: unknown }>): string {
  const folder = folders.filter((entry) => text(entry.type) && resource.startsWith(`${text(entry.name)}/`)).sort((a, b) => text(b.name).length - text(a.name).length)[0];
  return text(folder?.type) || resource.split('/')[0].normalize('NFC');
}

export function typeOf(resource: string, types: string[], projectPath?: string): string {
  const type = projectPath ? folderType(resource, readArborescence()) : resource.split('/')[0];
  return resource.includes('/') && types.includes(type) ? type : UNCLASSIFIED;
}

export function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const DATE_FORMS: Array<{ pattern: RegExp; year: number; month: number | ((name: string) => number); day: number }> = [
  { pattern: /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/, day: 1, month: 2, year: 3 },
  { pattern: /^(\d{4})-(\d{2})-(\d{2})$/, year: 1, month: 2, day: 3 },
  { pattern: /^(\d{1,2})(?:er)? ([a-z]+) (\d{4})$/, day: 1, month: (name) => MONTHS.indexOf(name) + 1, year: 3 },
];

export function isoDateOf(value: string): string | null {
  const candidate = fold(squash(value));
  for (const form of DATE_FORMS) {
    const match = form.pattern.exec(candidate);
    if (!match) continue;
    const year = Number(match[form.year]);
    const month = typeof form.month === 'function' ? form.month(match[2]) : Number(match[form.month]);
    const day = Number(match[form.day]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (month < 1 || month > 12 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}
