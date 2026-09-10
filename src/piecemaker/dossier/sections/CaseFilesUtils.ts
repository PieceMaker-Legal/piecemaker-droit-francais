/**
 * Formatting and small state-model helpers for the "Dossiers" section, kept
 * local to `sections/` for the same reason as `CaseFilesTypes.ts`.
 */

import type {
  CaseFileEntry,
  ChronologyGraph,
  ChronologyLegacyStatus,
  PieceProtectionState,
} from './CaseFilesTypes';

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

const LEGACY_STATUS_LABELS: Record<ChronologyLegacyStatus, string> = {
  ready: 'Analyse juridique à jour',
  stale: 'Analyse juridique à actualiser',
  building: 'Analyse juridique en cours…',
  failed: 'Échec de l’analyse juridique',
  blocked: 'Analyse juridique bloquée',
  empty: 'Analyse juridique non construite',
};

/** Badge tone, expressed as Tailwind classes rather than the admin panel's own CSS tokens. */
const LEGACY_STATUS_TONE: Record<ChronologyLegacyStatus, string> = {
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  stale: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  building: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  blocked: 'border-destructive/30 bg-destructive/10 text-destructive',
  empty: 'border-border/50 bg-muted/50 text-muted-foreground',
};

const REASON_LABELS: Record<string, string> = {
  aucune_personne_indexee: 'aucune personne visée',
  date_changed: 'date corrigée',
  nature_changed: 'type de pièce corrigé',
  document_entities_changed: 'entités de la pièce modifiées',
  semantic_corpus_changed: 'corpus juridique modifié',
  party_or_corpus_boundary_changed: 'parties ou périmètre modifiés',
  legal_prompt_version_changed: 'instructions d’analyse mises à jour',
  legal_integration_version_changed: 'intégration juridique mise à jour',
  legal_finalizer_version_changed: 'contrôles juridiques mis à jour',
  semantic_build_failed: 'dernière construction en échec',
  mapping_missing: 'mapping manquant',
  parties_required: 'parties à identifier',
  party_selection_invalid: 'sélection des parties invalide',
  no_party_documents: 'aucune pièce reliée aux parties',
};

function readableReason(reason: string): string {
  return REASON_LABELS[reason] || reason.split('_').join(' ');
}

export type ChronologyStateModel = {
  label: string;
  tone: string;
  canRefresh: boolean;
  detail: string;
};

/**
 * Ported from PieceMaker-Installer's admin/chronology-model.mjs
 * (chronologyStateModel), trimmed to what this section displays: no revision
 * comparison, no quality-flag rendering (those track document-entities
 * corrections, out of scope here).
 */
export function chronologyStateModel(graph: ChronologyGraph): ChronologyStateModel {
  const status: ChronologyLegacyStatus = LEGACY_STATUS_LABELS[graph.status] ? graph.status : 'empty';
  const reasons = [...new Set((graph.state?.semanticStaleReasons || []).map(readableReason).filter(Boolean))];
  const quarantined = Boolean(graph.state?.semanticQuarantined);
  return {
    label: LEGACY_STATUS_LABELS[status],
    tone: LEGACY_STATUS_TONE[status],
    canRefresh: status !== 'building' && status !== 'blocked',
    detail: quarantined
      ? 'L’ancienne analyse est masquée jusqu’à sa reconstruction.'
      : reasons.join(' · '),
  };
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
