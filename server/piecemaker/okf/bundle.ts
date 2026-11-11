import fs from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { DEFAULT_CLASSIFICATION } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

export const OKF_VERSION = '0.2';
export const RELATIONS = ['amends', 'responds-to', 'refers-to'];
export const SCAN_ACTOR = 'piecemaker/gliner';
export const AGENT_ACTOR = 'piecemaker/agent';
export const UNCLASSIFIED = 'Non classé';
export const DEFAULT_GRAPH_TYPES = ['Pièces'];
const RESERVED = new Set(['index.md', 'log.md']);

export type Frontmatter = Record<string, unknown>;
export type Relation = { target: string; citation: string; origin: string; dismissed?: boolean };
export type Relations = Record<string, Relation[]>;
export type Atom = { code: string; citation: string };
export type Concept = { id: string; frontmatter: Frontmatter; body: string; error?: string };

const posix = (value: string): string => value.split(path.sep).join('/').normalize('NFC');

export const bundleRoot = (projectPath: string): string => path.join(projectPath, '.piecemaker', 'okf');
export const conceptId = (resource: string): string => `/${posix(resource)}.md`;
export const conceptFile = (projectPath: string, id: string): string => path.join(bundleRoot(projectPath), ...id.slice(1).split('/'));
export const resourceOf = (projectPath: string, filePath: string): string => posix(path.relative(projectPath, filePath));
export const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();

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

export function atomsBody(atoms: Atom[]): string {
  if (!atoms.length) return '';
  return ['# Atomes', ...atoms.map((atom) => `## ${atom.code}\n\n> ${squash(atom.citation)}`)].join('\n\n');
}

export function parseAtoms(body: string): Atom[] {
  return [...body.matchAll(/^## (.+)\n\n> (.+)$/gm)].map((match) => ({ code: match[1].trim(), citation: match[2].trim() }));
}

export function relationsOf(frontmatter: Frontmatter): Relations {
  const source = frontmatter.relations;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const relations: Relations = {};
  for (const [name, entries] of Object.entries(source as Record<string, unknown>)) {
    relations[name] = (Array.isArray(entries) ? entries : []).map((entry) => {
      const value = (entry && typeof entry === 'object' ? entry : { target: entry }) as Record<string, unknown>;
      return { target: text(value.target), citation: text(value.citation), origin: text(value.origin), ...(value.dismissed === true ? { dismissed: true } : {}) };
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

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

export function readTypes(projectPath: string): string[] {
  const stored = readJson(path.join(projectPath, '.piecemaker', 'arborescence.json'));
  const folders = Array.isArray(stored) && stored.length ? stored as Array<{ name?: unknown }> : DEFAULT_CLASSIFICATION;
  return [...new Set(folders.map((folder) => text(folder.name).split('/')[0].normalize('NFC')).filter(Boolean))];
}

export function readGraphTypes(projectPath: string): string[] {
  const stored = readJson(path.join(projectPath, '.piecemaker', 'okf.json')) as { typesGraphe?: unknown } | null;
  const types = Array.isArray(stored?.typesGraphe) ? stored.typesGraphe.map(text).filter(Boolean) : [];
  return types.length ? types : DEFAULT_GRAPH_TYPES;
}

export function typeOf(resource: string, types: string[]): string {
  const segments = resource.split('/');
  return segments.length > 1 && types.includes(segments[0]) ? segments[0] : UNCLASSIFIED;
}

export function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}
