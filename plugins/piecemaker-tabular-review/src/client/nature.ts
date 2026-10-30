import type { ReviewRow } from '../shared.js';
import { escapeHtml } from './dom.js';
import type { CasePiece } from './sorting.js';

export type DocumentNode = {
  id: string;
  label: string;
  aliases: string[];
  date: string | null;
  data: Record<string, unknown>;
};

export const CUSTOM_NATURE = '__piecemaker_custom_nature__';

const PIECE_NATURES = ['assignation', 'conclusions', 'requête', 'courrier', 'courriel', 'mise en demeure', 'contrat', 'facture', 'devis', 'attestation', 'jugement', 'arrêt', 'ordonnance', 'procès-verbal', 'constat', 'expertise', 'statuts de société', 'extrait Kbis', 'relevé bancaire', 'acte notarié', 'bordereau de pièces'];

const natureOf = (node: DocumentNode): string => (typeof node.data.nature === 'string' ? node.data.nature : '');

function relativeTo(project: string, value: string): string {
  const file = value.replace(/\\/g, '/');
  const root = project.replace(/\\/g, '/').replace(/\/+$/, '');
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

export function nodeOfRow(row: ReviewRow, pieces: CasePiece[], nodes: DocumentNode[], project: string): DocumentNode | null {
  const source = row.documents[0]?.source;
  const piece = row.piece ?? (source ? pieces.find((entry) => entry.markdown && relativeTo(project, entry.markdown) === source)?.path : undefined);
  const wanted = relativeTo(project, piece ?? source ?? '');
  return nodes.find((node) => typeof node.data.path === 'string' && relativeTo(project, node.data.path) === wanted) ?? null;
}

export function natureField(node: DocumentNode, edit: { custom: boolean } | null): string {
  const nature = natureOf(node);
  const id = escapeHtml(node.id);
  if (edit?.custom) return `<div class="ptr-nature"><input class="ptr-nature-field" data-nature-input="${id}" aria-label="Type de pièce personnalisé" placeholder="Saisissez le type de pièce"></div>`;
  if (edit) {
    const options = [...new Set([nature, ...PIECE_NATURES].filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'fr', { sensitivity: 'base' }))
      .map((value) => `<option value="${escapeHtml(value)}"${value === nature ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
    return `<div class="ptr-nature"><select class="ptr-nature-field" data-nature-select="${id}" aria-label="Nature de ${escapeHtml(node.label)}"><option value="">— Aucune —</option>${options}<option value="${CUSTOM_NATURE}">Autre…</option></select></div>`;
  }
  return `<div class="ptr-nature"><button type="button" class="ptr-nature-pill" data-edit-nature="${id}" data-empty="${!nature}" title="Changer la nature du document">${escapeHtml(nature || 'Nature à renseigner')}</button></div>`;
}
