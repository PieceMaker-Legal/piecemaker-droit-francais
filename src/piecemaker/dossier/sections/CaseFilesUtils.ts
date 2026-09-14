/**
 * Formatting and small state-model helpers for the "Dossiers" section, kept
 * local to `sections/` for the same reason as `CaseFilesTypes.ts`.
 */

import type {
  CaseFileEntry,
  PieceProtectionState,
} from '@/piecemaker/dossier/sections/CaseFilesTypes';

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDateIso(dateIso: string | null | undefined): string {
  if (!dateIso) return 'Date inconnue';
  const date = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Derives the three-state protection model from the two backend booleans (see admin app.js PIECE_STATES). */
export function pieceProtectionState(file: Pick<CaseFileEntry, 'protected' | 'resource'>): PieceProtectionState {
  if (file.resource) return 'resource';
  if (!file.protected) return 'workspace';
  return 'vault';
}

export const PIECE_STATE_LABELS: Record<PieceProtectionState, string> = {
  vault: 'Protégée',
  workspace: 'Accessible à l’IA',
  resource: 'Ressource (jamais protégée)',
};

export const PIECE_STATE_HINTS: Record<PieceProtectionState, string> = {
  vault: 'Le contenu original reste hors de portée de l’IA ; seul le Markdown anonymisé lui est accessible.',
  workspace: 'La pièce originale est accessible telle quelle à l’IA, sans anonymisation.',
  resource: 'Gabarit ou pièce de référence : jamais protégée, jamais anonymisée.',
};

const ORIGINALS_STATUS_LABELS: Record<CaseFileEntry['status'], string> = {
  ready: 'Convertie et scannée',
  'awaiting-scan': 'Convertie · scan PII en attente',
  'not-converted': 'Non convertie',
};

export function originalsStatusLabel(file: CaseFileEntry): string {
  return ORIGINALS_STATUS_LABELS[file.status] || file.status;
}

export function describeJob(job: { action: string; state: string; percent?: number; processed?: number; total?: number; skipped?: number }): string {
  const actionLabel = job.action === 'anonymize' ? 'Anonymisation' : 'Conversion';
  if (job.state === 'queued') return `${actionLabel} en attente…`;
  if (job.state === 'error') return `${actionLabel} en échec`;
  if (job.state === 'done') {
    const skipped = job.skipped ? ` · ${job.skipped} ignorée(s)` : '';
    return `${actionLabel} terminée · ${job.processed ?? 0}/${job.total ?? 0} pièce(s)${skipped}`;
  }
  return `${Math.round(job.percent ?? 0)} %`;
}
