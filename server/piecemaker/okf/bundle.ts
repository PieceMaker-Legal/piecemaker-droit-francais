import fs from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { readArborescence } from './sealed.js';

export const UNCLASSIFIED = 'Non classé';
export const DEFAULT_GRAPH_TYPES = ['Pièces'];
export const DOCUMENT = 'Document';
const RESERVED = new Set(['index.md', 'log.md']);
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export type Frontmatter = Record<string, unknown>;
export type Concept = { id: string; frontmatter: Frontmatter; body: string; error?: string };

const posix = (value: string): string => value.split(path.sep).join('/').normalize('NFC');

export const bundleRoot = (projectPath: string): string => path.join(projectPath, '.piecemaker', 'okf');
export const conceptFile = (projectPath: string, id: string): string => path.join(bundleRoot(projectPath), ...id.slice(1).split('/'));
export const resourceOf = (projectPath: string, filePath: string): string => posix(path.relative(projectPath, filePath));
export const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const pieceOf = (resource: unknown): string => text(resource).replace(/^\/+/, '').normalize('NFC');

export function parseConcept(source: string): { frontmatter: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source.replace(/^﻿/, ''));
  if (!match) throw new Error('frontmatter YAML absent');
  const frontmatter = parse(match[1]) as unknown;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) throw new Error('frontmatter YAML illisible');
  return { frontmatter: frontmatter as Frontmatter, body: match[2] };
}

export function linksOf(id: string, body: string): string[] {
  const prose = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const targets = [...prose.matchAll(LINK)].flatMap(([, target]) => {
    const part = decodeURI(target.split('#')[0]);
    if (!part.endsWith('.md') || /^[a-z][a-z0-9+.-]*:/i.test(part)) return [];
    return [path.posix.normalize(part.startsWith('/') ? part : path.posix.join(path.posix.dirname(id), part)).normalize('NFC')];
  });
  return [...new Set(targets)].filter((target) => target !== id && !RESERVED.has(path.posix.basename(target)));
}

function conceptFiles(directory: string, prefix = ''): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}/${entry.name.normalize('NFC')}`;
    if (entry.isDirectory()) return relative === '/assets' ? [] : conceptFiles(path.join(directory, entry.name), relative);
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

export function readTypes(_projectPath?: string): string[] {
  const folders = readArborescence();
  return [...new Set(folders.map((folder) => folderType(`${text(folder.name)}/_`, folders)).filter(Boolean))];
}

function folderType(resource: string, folders: Array<{ name?: unknown; type?: unknown }>): string {
  const folder = folders.filter((entry) => text(entry.type) && resource.startsWith(`${text(entry.name)}/`)).sort((a, b) => text(b.name).length - text(a.name).length)[0];
  return text(folder?.type) || resource.split('/')[0].normalize('NFC');
}

export function typeOf(resource: string, types: string[]): string {
  const type = folderType(resource, readArborescence());
  return resource.includes('/') && types.includes(type) ? type : UNCLASSIFIED;
}
