import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { stringify } from 'yaml';

import { classifyColumn, documentTitle, isCellFilled, isDocumentTypeColumn } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { Cell, Review, ReviewColumn, ReviewRow } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import { DEFAULT_GRAPH_TYPES, DOCUMENT, bundleRoot, parseConcept, pieceOf, resourceError, resourceOf, text } from './bundle.js';
import { readArborescence } from './sealed.js';

export const DOCUMENTS = 'documents';
export const GENERATED_BY = 'index';

type Folder = { name?: unknown; type?: unknown };
export type IndexDocument = { file: string; resource: string; title: string; description: string; date: string; nature: string; classement: string; at: string; fields: Array<[string, string]> };

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const WRITTEN_DATE = /(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i;
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/;
const SUMMARY_COLUMNS = ['résumé', 'resume', 'synthèse', 'objet', 'événement', 'evenement', 'description'];
const MAX_SLUG = 80;
const MAX_VALUE = 280;

const squash = (value: string): string => value.replace(/\s+/g, ' ').replace(/\]\(/g, '] (').trim();
const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');
const short = (value: string, max = MAX_VALUE): string => value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
const compare = (left: string, right: string): number => left.localeCompare(right, 'fr', { sensitivity: 'base' });
const hash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 6);
const pad = (value: string | number): string => String(value).padStart(2, '0');
const validDay = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/** Date AAAA-MM-JJ d'une cellule Date de l'Index : « 2021-03-12 », « 12/03/2021 » ou « 12 mars 2021 ». */
export function indexDate(value: string): string {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  const written = WRITTEN_DATE.exec(trimmed);
  const numeric = NUMERIC_DATE.exec(trimmed);
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : written ? [Number(written[3]), MONTHS.indexOf(fold(written[2])) + 1, Number(written[1])]
      : numeric ? [Number(numeric[3]), Number(numeric[2]), Number(numeric[1])] : [0, 0, 0];
  return year && validDay(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : '';
}

/** Nom stable de la fiche d'une pièce, tiré de son chemin : « Pièces/Contrats/Contrat.pdf » → « pieces-contrats-contrat.md ». */
export function documentSlug(resource: string): string {
  const piece = pieceOf(resource).replace(/\.[^./]+$/, '');
  const slug = fold(piece).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'piece';
  return slug.length > MAX_SLUG ? `${slug.slice(0, MAX_SLUG).replace(/-+$/, '')}-${hash(pieceOf(resource))}` : slug;
}

const named = (review: Review, names: string[]): ReviewColumn | undefined => review.columns.find((column) => names.includes(text(column?.name).toLocaleLowerCase('fr').normalize('NFC')));
const isoAt = (...values: Array<string | undefined>): string => values.map((value) => text(value)).find((value) => value && !Number.isNaN(Date.parse(value))) || '';

/** Les pièces de l'Index rangées dans un dossier d'un type de pièces : une fiche par pièce, au nom stable. */
export function documentsFromIndex(projectPath: string, review: Review | null | undefined, folders: Folder[] = readArborescence(), pieceTypes: string[] = DEFAULT_GRAPH_TYPES): IndexDocument[] {
  if (!review || !Array.isArray(review.rows)) return [];
  const dateColumn = named(review, ['date']) ?? review.columns.find((column) => column.format === 'date');
  const natureColumn = review.columns.find((column) => isDocumentTypeColumn({ name: text(column?.name) })) ?? named(review, ['type']);
  const summaryColumn = SUMMARY_COLUMNS.map((name) => named(review, [name])).find(Boolean);
  const classColumn = classifyColumn(review.columns);
  const seen = new Map<string, Omit<IndexDocument, 'file'>>();
  for (const row of review.rows as ReviewRow[]) {
    const source = text(row.piece) || text(row.documents?.[0]?.source);
    if (!source || /^[a-z][a-z0-9+.-]*:/i.test(source)) continue;
    const resource = resourceOf(projectPath, path.resolve(projectPath, source));
    if (seen.has(resource) || resourceError(projectPath, `/${resource}`, folders, pieceTypes)) continue;
    const cells = review.cells?.[row.id] ?? {};
    const value = (column: ReviewColumn | undefined): string => {
      const cell: Cell | undefined = column ? cells[String(column.index)] : undefined;
      return isCellFilled(cell) ? squash(cell.summary) : '';
    };
    const date = indexDate(value(dateColumn));
    const nature = value(natureColumn);
    const title = squash(documentTitle(review, row)) || path.posix.basename(resource);
    const fallback = [nature || 'Pièce', date ? `du ${date}` : '', `(${path.posix.basename(resource)})`].filter(Boolean).join(' ');
    const fields = review.columns.flatMap((column): Array<[string, string]> => {
      const shown = value(column);
      return shown && text(column.name) ? [[text(column.name), short(shown)]] : [];
    });
    seen.set(resource, { resource, title: short(title, 160), description: short(value(summaryColumn) || fallback), date, nature, classement: value(classColumn), at: isoAt(row.finishedAt, review.updatedAt, review.createdAt), fields });
  }
  const slugs = new Map<string, string[]>();
  for (const resource of seen.keys()) slugs.set(documentSlug(resource), [...(slugs.get(documentSlug(resource)) ?? []), resource]);
  return [...seen.values()].map((document) => {
    const slug = documentSlug(document.resource);
    return { ...document, file: `${slugs.get(slug)!.length > 1 ? `${slug}-${hash(document.resource)}` : slug}.md` };
  }).sort((left, right) => compare(left.date || '9999', right.date || '9999') || compare(left.title, right.title) || compare(left.file, right.file));
}

export function renderDocument(document: IndexDocument): string {
  const frontmatter = {
    type: DOCUMENT,
    title: document.title,
    description: document.description,
    resource: `/${document.resource}`,
    ...(document.date ? { date: document.date } : {}),
    ...(document.nature ? { nature: document.nature } : {}),
    generated: { by: GENERATED_BY, ...(document.at ? { at: document.at } : {}) },
  };
  const fields = [`- Pièce : \`${document.resource}\``, ...document.fields.map(([name, value]) => `- ${name} : ${value}`)];
  return [
    `---\n${stringify(frontmatter).trim()}\n---`,
    `# ${document.title}`,
    'Fiche générée depuis l’Index du dossier. Ne la modifiez pas ici : corrigez l’Index.',
    `## Index\n\n${fields.join('\n')}`,
  ].join('\n\n') + '\n';
}

export function renderDocuments(documents: IndexDocument[]): Map<string, string> {
  const line = (document: IndexDocument): string => `- [${document.title.replace(/[[\]]/g, '')}](${encodeURI(document.file)})${[document.date, document.nature].filter(Boolean).length ? ` — ${[document.date, document.nature].filter(Boolean).join(' · ')}` : ''}`;
  const index = [
    '# Documents',
    'Fiches générées depuis l’Index du dossier, une par pièce d’un dossier de type pièces. Ne les modifiez pas ici : corrigez l’Index (`pm dossier index`).',
    documents.length ? documents.map(line).join('\n') : 'Aucune pièce.',
  ].join('\n\n') + '\n';
  return new Map([['index.md', index], ...documents.map((document): [string, string] => [document.file, renderDocument(document)])]);
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readConcept(file: string): Record<string, unknown> | null {
  try {
    return parseConcept(fs.readFileSync(file, 'utf8')).frontmatter;
  } catch {
    return null;
  }
}

/** Réécrit, hors de documents/, les liens vers une ancienne fiche Document remplacée par sa fiche générée. */
function retargetLinks(root: string, renames: Map<string, string>): void {
  if (!renames.size) return;
  const patterns = [...renames].flatMap(([previous, current]) => [...new Set([previous, encodeURI(previous)])]
    .map((name): [RegExp, string] => [new RegExp(`(\\]\\([^)\\s]*${DOCUMENTS}/)${escapeRegExp(name)}(?=[)#\\s])`, 'g'), `$1${encodeURI(current)}`]));
  const files = (fs.readdirSync(root, { recursive: true }) as string[]).filter((file) => file.endsWith('.md') && !file.startsWith(`${DOCUMENTS}${path.sep}`));
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    const updated = patterns.reduce((value, [pattern, target]) => value.replace(pattern, target), content);
    if (updated !== content) fs.writeFileSync(path.join(root, file), updated);
  }
}

const LINKED = new RegExp(`\\]\\(\\.?/?${DOCUMENTS}/index\\.md[)#\\s]`);

function linkFromRoot(root: string): void {
  const file = path.join(root, 'index.md');
  const content = fs.readFileSync(file, 'utf8');
  if (LINKED.test(content)) return;
  fs.writeFileSync(file, `${content.replace(/\s*$/, '')}\n\n- [Documents](${DOCUMENTS}/index.md) — générés depuis l’Index du dossier\n`);
}

/**
 * Régénère documents/ depuis l'Index du dossier, comme persons/ depuis la base : sans Index, rien ne change.
 * Une fiche générée dont la pièce a quitté l'Index disparaît ; une fiche Document écrite à la main pour une pièce
 * de l'Index cède la place à la fiche générée, et les liens qui la visaient sont réécrits.
 */
export function writeDocuments(projectPath: string, review: Review | null | undefined, pieceTypes: string[] = DEFAULT_GRAPH_TYPES): void {
  const root = bundleRoot(projectPath);
  if (!review || !fs.existsSync(path.join(root, 'index.md'))) return;
  const documents = documentsFromIndex(projectPath, review, readArborescence(), pieceTypes);
  const files = renderDocuments(documents);
  const fileOf = new Map(documents.map((document) => [document.resource, document.file]));
  const folder = path.join(root, DOCUMENTS);
  fs.mkdirSync(folder, { recursive: true });
  const renames = new Map<string, string>();
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith('.md') || files.has(name)) continue;
    const frontmatter = readConcept(path.join(folder, name));
    const generated = (frontmatter?.generated as { by?: unknown } | undefined)?.by === GENERATED_BY;
    const replacement = text(frontmatter?.type) === DOCUMENT ? fileOf.get(pieceOf(frontmatter?.resource)) : undefined;
    if (!generated && !replacement) continue;
    if (replacement) renames.set(name.normalize('NFC'), replacement);
    fs.rmSync(path.join(folder, name), { force: true });
  }
  retargetLinks(root, renames);
  for (const [name, content] of files) {
    const file = path.join(folder, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content);
  }
  linkFromRoot(root);
}
