import fs from 'node:fs';
import path from 'node:path';

import { REVIEW_FOLDER } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { Review } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import { factId, squash, text } from './bundle.js';

export type ReviewStatement = { candidates: string[]; quote: string; value: string };
export type ReviewFact = { id: string; title: string; description: string; single: boolean; statements: ReviewStatement[] };

function readReviews(projectPath: string): Review[] {
  const directory = path.join(projectPath, REVIEW_FOLDER);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const review = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as Review;
        return Array.isArray(review?.columns) && Array.isArray(review?.rows) ? [review] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => text(left.updatedAt).localeCompare(text(right.updatedAt)));
}

export function factsFromReviews(projectPath: string): ReviewFact[] {
  const facts = new Map<string, ReviewFact>();
  for (const review of readReviews(projectPath)) {
    for (const column of review.columns) {
      if (!column.fact || !text(column.name)) continue;
      const id = factId(column.name);
      const fact: ReviewFact = { id, title: text(column.name), description: squash(text(column.prompt)), single: column.fact === 'single', statements: facts.get(id)?.statements || [] };
      facts.set(id, fact);
      for (const row of review.rows) {
        const cell = review.cells?.[row.id]?.[column.index];
        const citation = cell?.citations?.find((entry) => entry.verified && text(entry.quote));
        if (!cell || !citation) continue;
        const candidates = [row.piece, ...(row.documents || []).map((document) => document.source)].filter((value): value is string => Boolean(value)).map((value) => value.normalize('NFC'));
        fact.statements.push({ candidates, quote: squash(citation.quote), value: squash(text(cell.summary)) });
      }
    }
  }
  return [...facts.values()];
}
