import { NAME } from './names.js';
import { finding } from './rules.js';
import type { Finding } from './rules.js';

export type Conflict = { sur: 'intitule' | 'texte' | 'section'; modele: string[]; avocat: string[] };
export type Section = { id?: string; intitule?: string; traite: string[]; texte: string[]; conflit: Conflict[]; sections: Section[] };
export type Located = { section: Section; at: string; depth: number; traite: string[] };
export type Segment = { text: string; gras: boolean; italique: boolean };

const SECTION_ID = /^s\d+$/;
const SECTION_KEYS = new Set(['id', 'intitule', 'traite', 'texte', 'conflit', 'sections']);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const filled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

export function readActe(raw: unknown): { sections: Section[]; problems: Array<Finding & { path: string }> } {
  const problems: Array<Finding & { path: string }> = [];
  const problem = (path: string, found: Finding) => { problems.push({ ...found, path }); };
  const seen = new Set<string>();
  const section = (entry: unknown, at: string): Section[] => {
    if (!isObject(entry)) { problem(at, finding('section-mal-formee')); return []; }
    for (const key of Object.keys(entry)) if (!SECTION_KEYS.has(key)) problem(`${at}.${key}`, finding('cle-non-reconnue', { cle: key, liste: [...SECTION_KEYS].join(', ') }));
    const result: Section = { traite: [], texte: [], conflit: [], sections: [] };
    if (entry.id !== undefined) {
      if (typeof entry.id !== 'string' || !SECTION_ID.test(entry.id)) problem(`${at}.id`, finding('id-de-section-mal-ecrit'));
      else if (seen.has(entry.id)) problem(`${at}.id`, finding('id-de-section-duplique', { id: entry.id }));
      else { seen.add(entry.id); result.id = entry.id; }
    }
    if (entry.intitule !== undefined) {
      if (!filled(entry.intitule) || entry.intitule.includes('\n')) problem(`${at}.intitule`, finding('intitule-mal-ecrit'));
      else result.intitule = entry.intitule;
    }
    if (entry.traite !== undefined) {
      const names = typeof entry.traite === 'string' ? [entry.traite] : entry.traite;
      if (!strings(names) || !names.length || names.some((name) => !NAME.test(name))) problem(`${at}.traite`, finding('traite-mal-ecrit'));
      else result.traite = names;
    }
    if (entry.texte !== undefined) {
      if (!strings(entry.texte)) problem(`${at}.texte`, finding('texte-mal-forme'));
      else entry.texte.forEach((paragraph, index) => {
        if (!paragraph.trim()) problem(`${at}.texte[${index}]`, finding('paragraphe-vide'));
        else if (paragraph.includes('\n')) problem(`${at}.texte[${index}]`, finding('paragraphe-multiligne'));
        else result.texte.push(paragraph);
      });
    }
    if (entry.conflit !== undefined) {
      const valid = Array.isArray(entry.conflit) && entry.conflit.every((item) => isObject(item) && ['intitule', 'texte', 'section'].includes(item.sur as string) && strings(item.modele) && strings(item.avocat) && Object.keys(item).every((key) => ['sur', 'modele', 'avocat'].includes(key)));
      if (!valid) problem(`${at}.conflit`, finding('conflit-mal-forme'));
      else result.conflit = entry.conflit as Conflict[];
    }
    if (entry.sections !== undefined) {
      if (!Array.isArray(entry.sections)) problem(`${at}.sections`, finding('sections-mal-formees'));
      else result.sections = entry.sections.flatMap((child, index) => section(child, `${at}.sections[${index}]`));
    }
    if (!result.intitule && !result.texte.length && !result.sections.length) problem(at, finding('section-vide'));
    return [result];
  };
  if (!Array.isArray(raw) || !raw.length) { problem('acte', finding('acte-mal-forme')); return { sections: [], problems }; }
  return { sections: raw.flatMap((entry, index) => section(entry, `acte[${index}]`)), problems };
}

export function assignIds(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const all: Array<Record<string, unknown>> = [];
  const collect = (list: unknown) => { if (Array.isArray(list)) for (const entry of list) if (isObject(entry)) { all.push(entry); collect(entry.sections); } };
  collect(raw);
  let next = Math.max(0, ...all.map((entry) => (typeof entry.id === 'string' && SECTION_ID.test(entry.id) ? Number(entry.id.slice(1)) : 0))) + 1;
  for (const entry of all) if (entry.id === undefined) entry.id = `s${next++}`;
}

export function locate(sections: Section[]): Located[] {
  const found: Located[] = [];
  const walk = (list: Section[], at: string, depth: number, inherited: string[]) => list.forEach((section, index) => {
    const here = `${at}[${index}]`;
    const traite = section.traite.length ? section.traite : inherited;
    found.push({ section, at: here, depth, traite });
    walk(section.sections, `${here}.sections`, depth + 1, traite);
  });
  walk(sections, 'acte', 0, []);
  return found;
}

export function segments(text: string): Segment[] {
  const result: Segment[] = [];
  let gras = false;
  let italique = false;
  let current = '';
  const flush = () => { if (current) result.push({ text: current, gras, italique }); current = ''; };
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith('**', index)) { flush(); gras = !gras; index += 1; }
    else if (text[index] === '*') { flush(); italique = !italique; }
    else current += text[index];
  }
  flush();
  return result;
}

export function markup(parts: Segment[]): string {
  let gras = false;
  let italique = false;
  let out = '';
  for (const part of parts) {
    if (!part.text) continue;
    if (italique && !part.italique) { out += '*'; italique = false; }
    if (gras !== part.gras) { out += '**'; gras = part.gras; }
    if (italique !== part.italique) { out += '*'; italique = part.italique; }
    out += part.text;
  }
  return `${out}${italique ? '*' : ''}${gras ? '**' : ''}`;
}

export const plain = (text: string) => segments(text).map((part) => part.text).join('');
export const normalize = (text: string) => plain(text).normalize('NFC').replace(/[’‘`´]/g, '\'').replace(/[“”«»"]/g, '').replace(/[  \s]+/g, ' ').trim().toLowerCase();

export function quotations(text: string): string[] {
  return [...plain(text).matchAll(/«\s*([^«»]+?)\s*»|“([^“”]+?)”/g)].map((match) => (match[1] ?? match[2]).trim()).filter((quote) => quote.split(/\s+/).length >= 3);
}

export type ActeContext = {
  known(name: string): boolean;
  status(name: string): string | null;
  citations(names: string[] | null): string[];
  objectives: Array<{ effet: string; at: string }>;
  obstacles: string[];
};
export type ActeIssue = Finding & { kind: 'erreur' | 'manque'; path: string; avocat: string };

const label = (section: Section) => section.intitule ?? `${plain(section.texte[0] ?? '').split(/\s+/).slice(0, 8).join(' ')}…`;
const phrase = (name: string) => name.replace(/_/g, ' ').replace(/(^|\s)([cdjlmnst]) (?=[aeiouyhàâéèêëîïôûù])/giu, '$1$2’');

export function checkActe(sections: Section[], context: ActeContext): ActeIssue[] {
  const issues: ActeIssue[] = [];
  const treated = new Set<string>();
  for (const { section, at, traite } of locate(sections)) {
    for (const name of section.traite) {
      treated.add(name);
      if (!context.known(name)) { issues.push({ ...finding('traite-non-defini', { nom: name }), kind: 'erreur', path: `${at}.traite`, avocat: `La section « ${label(section)} » renvoie à un point absent du raisonnement : ${phrase(name)}.` }); continue; }
      const status = context.status(name);
      if (status === 'à établir' || status === 'disputé') issues.push({ ...finding('point-non-etabli', { nom: name, statut: status }), kind: 'manque', path: `${at}.traite`, avocat: `La section « ${label(section)} » développe un point ${status} : ${phrase(name)}.` });
    }
    for (const conflict of section.conflit) issues.push({ ...finding('conflit-non-tranche', { objet: conflict.sur === 'section' ? 'la section entière' : conflict.sur === 'intitule' ? 'l’intitulé' : 'le texte', action: conflict.sur === 'section' ? 'Gardez ou retirez la section' : 'Reportez la version retenue' }), kind: 'erreur', path: `${at}.conflit`, avocat: `La section « ${label(section)} » a été retouchée à la fois dans le DOCX et dans le raisonnement : à trancher.` });
    const scope = traite.filter((name) => context.known(name));
    const pool = context.citations(scope.length ? scope : null).map(normalize);
    const paragraphs = [...(section.intitule ? [{ text: section.intitule, path: `${at}.intitule` }] : []), ...section.texte.map((text, index) => ({ text, path: `${at}.texte[${index}]` }))];
    for (const paragraph of paragraphs) for (const quote of quotations(paragraph.text)) {
      if (pool.some((citation) => citation.includes(normalize(quote)))) continue;
      issues.push({ ...finding('citation-hors-raisonnement', { citation: quote, portee: ` de ce que la section traite${scope.length ? ` (${scope.join(', ')})` : ''}` }), kind: 'erreur', path: paragraph.path, avocat: `La section « ${label(section)} » cite un passage que le raisonnement ne contient pas : « ${quote} ».` });
    }
  }
  for (const objective of context.objectives) if (!treated.has(objective.effet)) issues.push({ ...finding('objectif-non-developpe', { nom: objective.effet }), kind: 'manque', path: objective.at, avocat: `L’acte ne développe pas cet objectif.` });
  for (const name of new Set(context.obstacles)) if (context.known(name) && !treated.has(name)) issues.push({ ...finding('obstacle-non-discute', { nom: name }), kind: 'manque', path: 'acte', avocat: `L’acte ne répond pas à ce qui fait obstacle à l’objectif : ${phrase(name)}.` });
  return issues;
}
