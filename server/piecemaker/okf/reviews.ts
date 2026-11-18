import fs from 'node:fs';
import path from 'node:path';

import { REVIEW_FOLDER, documentTitleCell } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { Review } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import { text } from './bundle.js';

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
