import fs from 'node:fs';
import path from 'node:path';

import { REVIEW_FOLDER, documentTitleCell } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { Review } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import { premiseId, squash, text } from './bundle.js';

export type ReviewStatement = { candidates: string[]; quote: string; value: string };
export type ReviewPremise = { id: string; title: string; description: string; single: boolean; statements: ReviewStatement[] };

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

export function documentMetadataFromReviews(projectPath: string): Map<string, { title?: string; titleCitation?: string; nature?: string }> {
  const metadata = new Map<string, { title?: string; titleCitation?: string; nature?: string }>();
  for (const review of readReviews(projectPath)) {
    if (review.category === 'recherche-juridique') continue;
    const named = (names: string[]) => names.map((name) => review.columns.find((column) => text(column?.name).trim().toLocaleLowerCase('fr').normalize('NFC') === name)).find(Boolean);
    const natureColumn = named(['nature', 'type de document', 'type de pièce', 'type']);
    for (const row of review.rows) {
      const titleCell = documentTitleCell(review, row);
      const title = text(titleCell?.summary);
      const titleCitation = text(titleCell?.citations?.find((citation) => citation.verified)?.quote);
      const nature = natureColumn && text(review.cells?.[row.id]?.[natureColumn.index]?.summary);
      for (const source of [row.piece, ...(row.documents || []).map((document) => document.source)]) {
        if (!source) continue;
        const resource = path.relative(projectPath, path.resolve(projectPath, source)).normalize('NFC');
        metadata.set(resource, { ...metadata.get(resource), ...(title ? { title, titleCitation } : {}), ...(nature ? { nature } : {}) });
      }
    }
  }
  return metadata;
}

export function premisesFromReviews(projectPath: string): ReviewPremise[] {
  const premises = new Map<string, ReviewPremise>();
  for (const review of readReviews(projectPath)) {
    for (const column of review.columns) {
      if (!column.premise || !text(column.name)) continue;
      const id = premiseId(column.name);
      const premise: ReviewPremise = { id, title: text(column.name), description: squash(text(column.prompt)), single: column.premise === 'single', statements: premises.get(id)?.statements || [] };
      premises.set(id, premise);
      for (const row of review.rows) {
        const cell = review.cells?.[row.id]?.[column.index];
        const citation = cell?.citations?.find((entry) => entry.verified && text(entry.quote));
        if (!cell || !citation) continue;
        const candidates = [row.piece, ...(row.documents || []).map((document) => document.source)].filter((value): value is string => Boolean(value)).map((value) => value.normalize('NFC'));
        premise.statements.push({ candidates, quote: squash(citation.quote), value: squash(text(cell.summary)) });
      }
    }
  }
  return [...premises.values()];
}
