export function isLegalDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function readLegalPeriod(raw: string): { from: string; to: string | null } | undefined {
  const match = /^Validité:\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2}|en vigueur)\s*$/m.exec(raw.slice(0, 3000));
  if (!match || !isLegalDate(match[1]) || (match[2] !== 'en vigueur' && (!isLegalDate(match[2]) || match[2] <= match[1]))) return undefined;
  return { from: match[1], to: match[2] === 'en vigueur' ? null : match[2] };
}
