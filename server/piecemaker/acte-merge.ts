import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { FlatSection } from './acte-docx.js';

type Raw = Record<string, unknown>;
type Entry = { raw: Raw; depth: number };
type Hunk = { modele: string[]; avocat: string[] };
export type MergeReport = { reprises: string[]; ajoutees: string[]; supprimees: string[]; conflits: string[] };

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const texts = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const same = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item === right[index]);
const sameSection = (left: Pick<FlatSection, 'intitule' | 'texte'>, right: Pick<FlatSection, 'intitule' | 'texte'>) => (left.intitule ?? '') === (right.intitule ?? '') && same(left.texte, right.texte);
const labelOf = (section: Pick<FlatSection, 'id' | 'intitule' | 'texte'>) => `${section.id ? `${section.id} ` : ''}« ${section.intitule ?? `${(section.texte[0] ?? '').slice(0, 60)}…`} »`;

export function flattenActe(acte: unknown): Entry[] {
  const entries: Entry[] = [];
  const walk = (list: unknown, depth: number) => { if (Array.isArray(list)) for (const raw of list) if (isObject(raw)) { entries.push({ raw, depth }); walk(raw.sections, depth + 1); } };
  walk(acte, 0);
  return entries;
}

export const flatOf = (entry: Entry): FlatSection => ({ ...(typeof entry.raw.id === 'string' ? { id: entry.raw.id } : {}), depth: entry.depth, ...(typeof entry.raw.intitule === 'string' ? { intitule: entry.raw.intitule } : {}), texte: texts(entry.raw.texte) });

export function rebuildActe(entries: Entry[]): Raw[] {
  const roots: Raw[] = [];
  const stack: Array<{ depth: number; raw: Raw }> = [];
  for (const entry of entries) {
    const { sections: _sections, ...raw } = entry.raw;
    while (stack.length && stack[stack.length - 1].depth >= entry.depth) stack.pop();
    const parent = stack[stack.length - 1]?.raw;
    if (parent) parent.sections = [...(parent.sections as Raw[] | undefined ?? []), raw];
    else roots.push(raw);
    stack.push({ depth: entry.depth, raw });
  }
  return roots;
}

const run = (args: string[]) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
});

export async function mergeParagraphs(base: string[], modele: string[], avocat: string[]): Promise<{ texte: string[]; conflits: Hunk[] }> {
  if (same(avocat, base) || same(modele, avocat)) return { texte: modele, conflits: [] };
  if (same(modele, base)) return { texte: avocat, conflits: [] };
  const folder = await mkdtemp(path.join(os.tmpdir(), 'piecemaker-acte-'));
  try {
    const files = { modele: path.join(folder, 'modele'), base: path.join(folder, 'base'), avocat: path.join(folder, 'avocat') };
    const content = (lines: string[]) => (lines.length ? `${lines.join('\n')}\n` : '');
    await Promise.all([writeFile(files.modele, content(modele)), writeFile(files.base, content(base)), writeFile(files.avocat, content(avocat))]);
    const result = await run(['merge-file', '-p', '--diff3', '-L', 'modele', '-L', 'base', '-L', 'avocat', files.modele, files.base, files.avocat]);
    if (result.code < 0 || result.code > 127) throw new Error(`git merge-file a échoué : ${result.stderr.trim()}`);
    const texte: string[] = [];
    const conflits: Hunk[] = [];
    let hunk: (Hunk & { base: string[] }) | null = null;
    let side: 'modele' | 'base' | 'avocat' = 'modele';
    const settle = (block: Hunk & { base: string[] }) => {
      const aligned = block.base.length === block.modele.length && block.base.length === block.avocat.length;
      const lines = aligned ? block.base.map((line, index) => (block.modele[index] === line || block.modele[index] === block.avocat[index] ? block.avocat[index] : block.avocat[index] === line ? block.modele[index] : null)) : [null];
      if (lines.every((line) => line !== null)) { texte.push(...(lines as string[])); return; }
      texte.push(...block.modele);
      conflits.push({ modele: block.modele, avocat: block.avocat });
    };
    for (const line of result.stdout.replace(/\n$/, '').split('\n')) {
      if (line === '<<<<<<< modele') { hunk = { modele: [], base: [], avocat: [] }; side = 'modele'; continue; }
      if (hunk && side === 'modele' && line === '||||||| base') { side = 'base'; continue; }
      if (hunk && side === 'base' && line === '=======') { side = 'avocat'; continue; }
      if (hunk && side === 'avocat' && line === '>>>>>>> avocat') { settle(hunk); hunk = null; continue; }
      if (hunk) hunk[side].push(line);
      else texte.push(line);
    }
    return { texte: texte.filter((line) => line.trim()), conflits };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export async function mergeActe(acte: unknown, base: FlatSection[], docx: FlatSection[]): Promise<{ acte: Raw[]; rapport: MergeReport }> {
  const rapport: MergeReport = { reprises: [], ajoutees: [], supprimees: [], conflits: [] };
  const model = flattenActe(acte);
  const baseById = new Map(base.filter((section) => section.id).map((section) => [section.id!, section]));
  const docxById = new Map(docx.filter((section) => section.id && baseById.has(section.id)).map((section) => [section.id!, section]));
  const modelIds = new Set(model.map((entry) => entry.raw.id).filter((id): id is string => typeof id === 'string'));
  const conflict = (raw: Raw, entry: { sur: string; modele: string[]; avocat: string[] }) => { raw.conflit = [...(Array.isArray(raw.conflit) ? raw.conflit : []), entry]; };
  const output: Entry[] = [];
  for (const entry of model) {
    const id = typeof entry.raw.id === 'string' ? entry.raw.id : undefined;
    const before = id ? baseById.get(id) : undefined;
    const edited = id ? docxById.get(id) : undefined;
    const current = flatOf(entry);
    if (!before) { output.push(entry); continue; }
    if (!edited) {
      if (sameSection(current, before)) { rapport.supprimees.push(labelOf(current)); continue; }
      conflict(entry.raw, { sur: 'section', modele: current.texte, avocat: [] });
      rapport.conflits.push(labelOf(current));
      output.push(entry);
      continue;
    }
    let conflicted = false;
    const [b, m, a] = [before.intitule ?? '', current.intitule ?? '', edited.intitule ?? ''];
    const title = a === b || m === a ? m : m === b ? a : null;
    if (title === null) { conflict(entry.raw, { sur: 'intitule', modele: [m], avocat: [a] }); conflicted = true; }
    else if (title) entry.raw.intitule = title;
    else delete entry.raw.intitule;
    const merged = await mergeParagraphs(before.texte, current.texte, edited.texte);
    if (merged.texte.length) entry.raw.texte = merged.texte;
    else delete entry.raw.texte;
    for (const hunk of merged.conflits) conflict(entry.raw, { sur: 'texte', ...hunk });
    conflicted ||= merged.conflits.length > 0;
    if (conflicted) rapport.conflits.push(labelOf(current));
    else if (!sameSection(edited, before)) rapport.reprises.push(labelOf(current));
    output.push(entry);
  }
  let anchor: Entry | null = null;
  for (const edited of docx) {
    const kept = edited.id && docxById.has(edited.id) ? output.find((entry) => entry.raw.id === edited.id) : undefined;
    if (kept) { anchor = kept; continue; }
    if (edited.id && docxById.has(edited.id) && !modelIds.has(edited.id)) {
      if (sameSection(edited, baseById.get(edited.id)!)) continue;
      const raw: Raw = { id: edited.id, ...(edited.intitule ? { intitule: edited.intitule } : {}), ...(edited.texte.length ? { texte: edited.texte } : {}), conflit: [{ sur: 'section', modele: [], avocat: edited.texte }] };
      const entry = { raw, depth: edited.depth };
      output.splice(anchor ? output.indexOf(anchor) + 1 : 0, 0, entry);
      rapport.conflits.push(labelOf(edited));
      anchor = entry;
      continue;
    }
    if (!edited.id && base.some((before) => !before.id && sameSection(before, edited))) continue;
    const raw: Raw = { ...(edited.intitule ? { intitule: edited.intitule } : {}), ...(edited.texte.length ? { texte: edited.texte } : {}) };
    if (!Object.keys(raw).length) continue;
    const entry = { raw, depth: edited.depth };
    output.splice(anchor ? output.indexOf(anchor) + 1 : 0, 0, entry);
    rapport.ajoutees.push(labelOf(edited));
    anchor = entry;
  }
  return { acte: rebuildActe(output), rapport };
}

export function alreadyMerged(model: FlatSection[], base: FlatSection[], docx: FlatSection[]): boolean {
  const modelById = new Map(model.filter((section) => section.id).map((section) => [section.id!, section]));
  const baseById = new Map(base.filter((section) => section.id).map((section) => [section.id!, section]));
  const docxIds = new Set(docx.map((section) => section.id).filter(Boolean));
  for (const section of docx) {
    const known = section.id ? modelById.get(section.id) : undefined;
    const before = section.id ? baseById.get(section.id) : undefined;
    if (known && sameSection(section, known)) continue;
    if (before && sameSection(section, before)) continue;
    if (!section.id && [...model, ...base.filter((entry) => !entry.id)].some((entry) => sameSection(entry, section))) continue;
    return false;
  }
  return [...baseById.keys()].every((id) => docxIds.has(id) || !modelById.has(id) || !sameSection(modelById.get(id)!, baseById.get(id)!));
}
