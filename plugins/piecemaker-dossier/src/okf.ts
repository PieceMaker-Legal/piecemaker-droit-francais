import { requestJson } from '../../../src/shared/authToken.js';

import type { DocumentType } from './document-types.js';

export type OkfRelation = { relation: string; target: string; piece?: string; citation: string; origin: string; at?: string; value?: string };
export type OkfFiche = { id: string; type: string; title: string; titleCitation?: string; description: string; resource: string; date: string; nature?: string; icon?: string; side?: string; lof?: string; generated?: { by: string; at: string }; relations: OkfRelation[] };
export type OkfRelationLabel = { name: string; label: string; inverse: string; kind?: 'objprop' | 'dataprop' };
export type OkfIndex = { types: string[]; typesGraphe: string[]; fiches: OkfFiche[]; ontologie?: OkfRelationLabel[]; classes?: string[]; documentTypes?: DocumentType[] };
export type PendingProposals = { arborescence: number };

export const isDocument = (fiche: Pick<OkfFiche, 'lof'>): boolean => fiche.lof === 'Document';
export const isParty = (fiche: Pick<OkfFiche, 'lof'>): boolean => fiche.lof === 'Rôle';
export const isEntity = (fiche: Pick<OkfFiche, 'lof'>): boolean => !isDocument(fiche) && !isParty(fiche);

export function relationLabel(index: OkfIndex | null, name: string, incoming = false): string {
  return incoming ? index?.ontologie?.find((relation) => relation.name === name)?.inverse || name : name;
}

const request = <T>(path: string, payload?: unknown, method?: string): Promise<T> => requestJson<T>(`/api/piecemaker/okf${path}`, payload, method);

export const okfApi = {
  read: (projectId: string) => request<OkfIndex>(`?projectId=${encodeURIComponent(projectId)}`),
};

export type PieceStatement = { source: string; sourceTitle: string; relation: string; target: string; targetTitle: string; citation: string; value: string };

const pieceOf = (fiche: OkfFiche, entry: OkfRelation) => entry.piece || (isDocument(fiche) ? fiche.id : '');

export function pieceStatements(index: OkfIndex | null, resource: string): PieceStatement[] {
  const document = index?.fiches.find((entry) => entry.resource === resource.normalize('NFC'));
  if (!index || !document) return [];
  const titleOf = (id: string) => index.fiches.find((fiche) => fiche.id === id)?.title || id;
  return index.fiches.flatMap((fiche) => fiche.relations
    .filter((entry) => pieceOf(fiche, entry) === document.id)
    .map((entry) => ({ source: fiche.id, sourceTitle: fiche.title, relation: entry.relation, target: entry.target, targetTitle: titleOf(entry.target), citation: entry.citation, value: entry.value || '' })));
}

export function entities(index: OkfIndex | null): OkfFiche[] {
  return (index?.fiches || []).filter(isEntity).sort((left, right) => left.title.localeCompare(right.title, 'fr', { sensitivity: 'base' }));
}

const linkTitle = (entry: OkfRelation, title: string) => entry.value ? `${title} : ${entry.value}` : title;

export function ficheLinks(index: OkfIndex | null, resource: string): Array<{ label: string; title: string; citation: string }> {
  const fiche = index?.fiches.find((entry) => entry.resource === resource.normalize('NFC'));
  if (!index || !fiche) return [];
  const titleOf = (id: string) => index.fiches.find((entry) => entry.id === id)?.title || id;
  return [
    ...fiche.relations.map((entry) => ({ label: `${relationLabel(index, entry.relation)} →`, title: linkTitle(entry, titleOf(entry.target)), citation: entry.citation })),
    ...index.fiches.flatMap((other) => other.relations
      .filter((entry) => entry.target === fiche.id)
      .map((entry) => ({ label: `← ${relationLabel(index, entry.relation, true)}`, title: other.title, citation: entry.citation }))),
  ];
}

export function graphElements(index: OkfIndex, withEntities = true): Array<{ data: Record<string, string> }> {
  const fiches = index.fiches.filter((fiche) => isParty(fiche) || (isEntity(fiche) ? withEntities : index.typesGraphe.includes(fiche.type)));
  const ids = new Set(fiches.map((fiche) => fiche.id));
  const kind = (fiche: OkfFiche) => isEntity(fiche) ? 'premise' : isParty(fiche) ? `party-${fiche.side === 'adversaire' ? 'adverse' : fiche.side || 'tiers'}` : 'document';
  return [
    ...fiches.map((fiche) => ({ data: { id: fiche.id, label: fiche.title.replace(/\.(?:pdf|docx?|xlsx?|png|jpe?g|txt|md)$/i, ''), resource: fiche.resource, kind: kind(fiche), type: fiche.type, icon: isEntity(fiche) ? 'diamond' : isParty(fiche) ? 'users' : fiche.icon || 'file' } })),
    ...fiches.flatMap((fiche) => fiche.relations
      .filter((entry) => ids.has(entry.target))
      .map((entry) => ({ data: { id: `${fiche.id}|${entry.relation}|${entry.target}`, source: fiche.id, target: entry.target, label: relationLabel(index, entry.relation), relation: entry.relation } }))),
  ];
}

export type Evidence = { piece: string; resource: string; label: string; value: string; citation: string; origin: string; at?: string };

export function entityEvidence(index: OkfIndex, entityId: string): Evidence[] {
  const fiche = index.fiches.find((entry) => entry.id === entityId);
  const byId = (id: string) => index.fiches.find((entry) => entry.id === id);
  const evidence = (owner: OkfFiche, entry: OkfRelation, label: string) => {
    const piece = byId(pieceOf(owner, entry));
    return piece ? [{ piece: piece.title, resource: piece.resource, label, value: entry.value || '', citation: entry.citation, origin: entry.origin, at: entry.at }] : [];
  };
  const outgoing = (fiche?.relations || []).flatMap((entry) => evidence(fiche!, entry, entry.value ? entry.relation : `${entry.relation} → ${byId(entry.target)?.title || entry.target}`));
  const incoming = index.fiches.flatMap((other) => other.relations.filter((entry) => entry.target === entityId && other.id !== entityId).flatMap((entry) => evidence(other, entry, `${other.title} · ${entry.relation}`)));
  return [...outgoing, ...incoming];
}

export function linkedEntities(index: OkfIndex | null, ficheId: string): OkfFiche[] {
  const fiche = index?.fiches.find((entry) => entry.id === ficheId);
  if (!index || !fiche) return [];
  const targets = new Set(fiche.relations.map((entry) => entry.target));
  return entities(index).filter((entity) => targets.has(entity.id) || entity.relations.some((entry) => entry.target === ficheId));
}

export function partyEntities(index: OkfIndex | null, code: string): OkfFiche[] {
  const party = index?.fiches.find((fiche) => isParty(fiche) && fiche.title === code);
  return party ? linkedEntities(index, party.id) : [];
}
