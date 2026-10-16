import type { ReasoningPeriod } from '../../../shared/piecemaker-reasoning.js';

import { isLegalDate } from './model.js';

export function readLegalPeriod(raw: string): ReasoningPeriod | undefined {
  const match = /^Validité:\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2}|en vigueur)\s*$/m.exec(raw.slice(0, 3000));
  if (!match || !isLegalDate(match[1]) || (match[2] !== 'en vigueur' && (!isLegalDate(match[2]) || match[2] <= match[1]))) return undefined;
  return { from: match[1], to: match[2] === 'en vigueur' ? null : match[2] };
}
