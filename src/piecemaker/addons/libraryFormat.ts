const sizeFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat('fr-FR');

export function formatAddonsDocumentSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return '—';
  if (sizeBytes < 1024) return `${sizeFormatter.format(sizeBytes)} o`;
  if (sizeBytes < 1024 * 1024) return `${sizeFormatter.format(sizeBytes / 1024)} Ko`;
  return `${sizeFormatter.format(sizeBytes / (1024 * 1024))} Mo`;
}

export function formatAddonsDocumentDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return dateFormatter.format(parsed);
}
