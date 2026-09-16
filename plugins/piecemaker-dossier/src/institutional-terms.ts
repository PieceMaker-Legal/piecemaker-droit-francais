import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type InstitutionalTermsStore = { file: string; terms: string[] };

type MatcherCache = { key: string; terms: string[]; matchers: RegExp[] };

let cache: MatcherCache | null = null;

function piecemakerHome(): string {
  return process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
}

export function institutionalTermsFile(): string {
  return process.env.PIECEMAKER_INSTITUTIONAL_TERMS || path.join(piecemakerHome(), 'institutional-terms.json');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeForMatch(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/['‘’ʼ´`]/g, "'")
    .replace(/[\s ]+/g, ' ')
    .trim();
}

export function cleanTerm(value: unknown): string {
  return String(value || '').replace(/[\s ]+/g, ' ').trim();
}

export function dedupeTerms(terms: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(terms) ? terms : []) {
    const display = cleanTerm(raw);
    const key = normalizeForMatch(display);
    if (!display || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(display);
  }
  return out.sort((left, right) => normalizeForMatch(left).localeCompare(normalizeForMatch(right), 'fr'));
}

function readTermsFrom(file: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { terms?: unknown })?.terms;
    return dedupeTerms(list);
  } catch {
    return [];
  }
}

export function readInstitutionalTerms(): InstitutionalTermsStore {
  const file = institutionalTermsFile();
  return { file, terms: readTermsFrom(file) };
}

function statSignature(file: string): string {
  try {
    const stats = fs.statSync(file);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return 'absent';
  }
}

function compileMatchers(terms: string[]): RegExp[] {
  const matchers: RegExp[] = [];
  for (const term of terms) {
    const normalized = normalizeForMatch(term);
    if (!normalized) continue;
    const body = normalized.split(' ').map(escapeRegex).join('\\s+');
    matchers.push(new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u'));
  }
  return matchers;
}

function currentMatchers(): MatcherCache {
  const file = institutionalTermsFile();
  const key = `${file}#${statSignature(file)}`;
  if (!cache || cache.key !== key) {
    const terms = readTermsFrom(file);
    cache = { key, terms, matchers: compileMatchers(terms) };
  }
  return cache;
}

export function isInstitutionalEntity(entity: unknown): boolean {
  const { matchers } = currentMatchers();
  if (!matchers.length) return false;
  const normalized = normalizeForMatch(entity);
  if (!normalized) return false;
  return matchers.some((matcher) => matcher.test(normalized));
}
