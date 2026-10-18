import type { ReasoningPeriod } from '../../../shared/piecemaker-reasoning.js';

export function isLegalDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function readLegalPeriod(raw: string): ReasoningPeriod | undefined {
  const match = /^Validité:\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2}|en vigueur)\s*$/m.exec(raw.slice(0, 3000));
  if (!match || !isLegalDate(match[1]) || (match[2] !== 'en vigueur' && (!isLegalDate(match[2]) || match[2] <= match[1]))) return undefined;
  return { from: match[1], to: match[2] === 'en vigueur' ? null : match[2] };
}

export function readHistory(raw: string) {
  const match = /^Historique: (non remise en cause|remise en cause|à examiner)\s*$/m.exec(raw);
  if (!match) return undefined;
  const lines = raw.slice(match.index + match[0].length).split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2));
  return { status: match[1] as 'non remise en cause' | 'remise en cause' | 'à examiner', lines };
}
