import fs from 'node:fs';

import type { Cell, CellCitation, CitationSource, ReviewColumn, TextRange } from '../shared.js';
import { citationIssue } from '../shared.js';
import { assertReviewFile, documentPath, isInside, reviewDirectory, UserError } from './paths.js';
import { readReview } from './reviews.js';

export type CitationDocument = {
  name: string;
  text: string;
};

export type CitationProblem = {
  column: ReviewColumn;
  kind: 'absent' | 'missing' | 'unverified';
  quotes: CellCitation[];
};

const ELLIPSIS = /\.{3}|…|\[\[PAGE_BREAK\]\]/;

function isPunctuation(character: string): boolean {
  return !/[\p{L}\p{N}\s]/u.test(character);
}

function normalizeWithMap(text: string, stripPunctuation: boolean): { norm: string; origin: number[] } {
  const norm: string[] = [];
  const origin: number[] = [];
  let previousSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) {
      if (!previousSpace) {
        norm.push(' ');
        origin.push(index);
        previousSpace = true;
      }
    } else if (!(stripPunctuation && isPunctuation(character))) {
      norm.push(character.toLowerCase());
      origin.push(index);
      previousSpace = false;
    }
  }
  return { norm: norm.join(''), origin };
}

function locateNormalized(source: string, quote: string, stripPunctuation: boolean): TextRange | null {
  const needle = normalizeWithMap(quote, stripPunctuation).norm.trim();
  if (!needle) return null;
  const { norm, origin } = normalizeWithMap(source, stripPunctuation);
  const position = norm.indexOf(needle);
  if (position < 0) return null;
  const last = position + needle.length - 1;
  return { start: origin[position] ?? 0, end: last < origin.length ? origin[last] + 1 : source.length };
}

export function locateQuote(source: string, quote: string): TextRange | null {
  if (!source || !quote) return null;
  const exact = source.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  return locateNormalized(source, quote, false) ?? locateNormalized(source, quote, true);
}

export function quoteRanges(source: string, quote: string): TextRange[] | null {
  const segments = quote.replace(/^[\s«»"“”]+|[\s«»"“”]+$/g, '').split(ELLIPSIS).map((segment) => segment.trim()).filter((segment) => /[\p{L}\p{N}]/u.test(segment));
  if (!segments.length) return null;
  const ranges: TextRange[] = [];
  for (const segment of segments) {
    const range = locateQuote(source, segment);
    if (!range) return null;
    ranges.push(range);
  }
  return ranges;
}

function sameDocument(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\\/g, '/');
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.split('/').pop() === b.split('/').pop();
}

export function verifyCitation(documents: CitationDocument[], citation: Pick<CellCitation, 'document' | 'quote'>): CellCitation {
  const ordered = [...documents.filter((entry) => sameDocument(entry.name, citation.document)), ...documents.filter((entry) => !sameDocument(entry.name, citation.document))];
  for (const document of ordered) {
    const ranges = quoteRanges(document.text, citation.quote);
    if (ranges) return { document: document.name, quote: citation.quote, verified: true, ranges };
  }
  return { document: citation.document, quote: citation.quote, verified: false };
}

export function verifyCells(cells: Map<number, Cell>, documents: CitationDocument[]): Map<number, Cell> {
  for (const [index, cell] of cells) {
    cells.set(index, { ...cell, citations: (cell.citations ?? []).map((citation) => verifyCitation(documents, citation)) });
  }
  return cells;
}

export function citationProblems(cells: Map<number, Cell>, columns: ReviewColumn[]): CitationProblem[] {
  const problems: CitationProblem[] = [];
  for (const column of columns) {
    const cell = cells.get(column.index);
    if (!cell) {
      problems.push({ column, kind: 'absent', quotes: [] });
      continue;
    }
    const issue = citationIssue(cell);
    if (issue) problems.push({ column, kind: issue, quotes: (cell.citations ?? []).filter((citation) => !citation.verified) });
  }
  return problems;
}

function problemLine(problem: CitationProblem): string {
  const heading = `- Colonne ${problem.column.index} — "${problem.column.name}" : `;
  if (problem.kind === 'absent') return `${heading}aucune ligne JSON n’a été fournie pour cette colonne.`;
  if (problem.kind === 'missing') return `${heading}la réponse ne comporte aucune citation.`;
  return `${heading}${problem.quotes.length > 1 ? 'ces extraits sont introuvables' : 'cet extrait est introuvable'} dans les documents : ${problem.quotes.map((citation) => `« ${citation.quote} » (${citation.document})`).join(' ; ')}.`;
}

export function correctionPrompt(problems: CitationProblem[], attempt: number, limit: number): string {
  return [
    `Vérification automatique des citations (relance ${attempt}/${limit}) : chaque réponse doit être étayée par au moins une citation retrouvée mot pour mot dans les documents.`,
    '',
    ...problems.map(problemLine),
    '',
    'Réécris uniquement les lignes JSON de ces colonnes, au même format. Copie chaque extrait caractère pour caractère depuis le document (sans reformuler, corriger ni traduire) et indique le nom exact du document. Pour omettre un passage à l’intérieur d’un extrait, utilise « … ».',
    'Si, après relecture, l’information est absente des documents, réponds "Non trouvé" avec le flag "grey" et une liste "citations" vide.',
    'N’écris QUE les lignes JSON.',
  ].join('\n');
}

const SOURCE_WINDOW = 60_000;

export function citationSource(project: string, file: string, rowId: string, column: number, number: number): CitationSource {
  assertReviewFile(project, file);
  const review = readReview(project, file);
  const row = review.rows.find((entry) => entry.id === rowId);
  const citation = review.cells[rowId]?.[String(column)]?.citations?.[number];
  if (!row || !citation) throw new UserError('Citation introuvable.');
  const document = row.documents.find((entry) => sameDocument(entry.source, citation.document)) ?? row.documents[0];
  if (!document) throw new UserError('Document source introuvable.');
  const absolute = documentPath(project, document.copy);
  if (!isInside(reviewDirectory(project), absolute) || !fs.existsSync(absolute)) throw new UserError('Document source introuvable.');
  const text = fs.readFileSync(absolute, 'utf8');
  const ranges = (citation.verified ? citation.ranges : null) ?? quoteRanges(text, citation.quote) ?? [];
  const anchor = ranges[0]?.start ?? 0;
  const offset = text.length <= SOURCE_WINDOW ? 0 : Math.max(0, Math.min(anchor - SOURCE_WINDOW / 4, text.length - SOURCE_WINDOW));
  const end = Math.min(text.length, offset + SOURCE_WINDOW);
  return {
    document: document.source,
    link: /^https:\/\//.test(document.source) ? document.source : null,
    quote: citation.quote,
    verified: citation.verified,
    text: text.slice(offset, end),
    offset,
    length: text.length,
    ranges: ranges.filter((range) => range.start >= offset && range.end <= end).map((range) => ({ start: range.start - offset, end: range.end - offset })),
  };
}
