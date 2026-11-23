import { requestJson } from '../../../src/shared/authToken.js';

import { iconSvg } from './document-types.js';
import type { DocumentType } from './document-types.js';
import type { ClassificationFolder } from '../../piecemaker-tabular-review/src/shared.js';

export type OkfRelation = { relation: string; target: string; piece?: string; citation: string; origin: string; at?: string; value?: string };
export type OkfReviewRow = { row: string; label: string; resource: string; value: string; citation: string; author: 'human' | 'agent'; checkedAt?: string };
export type OkfReviewLink = { fichier: string; colonne: number; titre: string; question: string; by: string; at: string; lignes: OkfReviewRow[]; erreur?: string };
export type OkfReviewChoice = { fichier: string; titre: string; colonnes: Array<{ index: number; nom: string; format: string }> };
export type OkfFiche = { id: string; type: string; title: string; titleCitation?: string; description: string; resource: string; date: string; nature?: string; icon?: string; side?: string; lof?: string; generated?: { by: string; at: string }; examen?: { motif: string; by: string; at: string } | null; revues?: OkfReviewLink[]; relations: OkfRelation[] };
export type OkfRelationLabel = { name: string; label: string; inverse: string; kind?: 'objprop' | 'dataprop' };
export type OkfIndex = { types: string[]; typesGraphe: string[]; fiches: OkfFiche[]; ontologie?: OkfRelationLabel[]; classes?: string[]; documentTypes?: DocumentType[] };
export type LofEntry = { id: string; iri: string; label: string; kind: 'class' | 'objprop' | 'dataprop' | 'individual'; annotations: string[][]; subClassOf?: string[]; domain?: string[]; range?: string[]; inverseOf?: string[]; subPropertyOf?: string[]; type?: string[]; axioms?: Array<{ k: string; m: string }> };
export type OntologyProposal = { arborescence?: ClassificationFolder[]; motif: string; date: string };
export type OntologyState = { personnalisee: boolean; erreur?: string; lof: LofEntry[]; attribution: string; source: string; types: string[]; fichier?: string; proposition?: OntologyProposal | null };
export type PendingProposals = { arborescence: number };
export type OkfLink = { source: string; relation: string; target?: string; piece?: string; source_class?: string; target_class?: string; citation?: string; value?: string };

export const isEntity = (fiche: Pick<OkfFiche, 'id'>): boolean => fiche.id.startsWith('/_lof/') || fiche.id.startsWith('/_premises/');
export const isParty = (fiche: Pick<OkfFiche, 'id'>): boolean => fiche.id.startsWith('/_parties/');
export const isDocument = (fiche: Pick<OkfFiche, 'id'>): boolean => !isEntity(fiche) && !isParty(fiche);

export function relationLabel(index: OkfIndex | null, name: string, incoming = false): string {
  return incoming ? index?.ontologie?.find((relation) => relation.name === name)?.inverse || name : name;
}

const request = <T>(path: string, payload?: unknown, method?: string): Promise<T> => requestJson<T>(`/api/piecemaker/okf${path}`, payload, method);

export const okfApi = {
  read: (projectId: string) => request<OkfIndex>(`?projectId=${encodeURIComponent(projectId)}`),
  rebuild: (projectId: string) => request<{ written: number; removed: number }>('/rebuild', { projectId }),
  link: (projectId: string, link: OkfLink) => request<OkfLink>('/link', { projectId, ...link }),
  unlink: (projectId: string, link: OkfLink) => request<OkfLink>('/unlink', { projectId, ...link }),
  reviews: (projectId: string) => request<{ revues: OkfReviewChoice[] }>(`/revues?projectId=${encodeURIComponent(projectId)}`),
  linkReview: (projectId: string, premise: string, fichier: string, colonne: number, retirer = false) => request<{ premise: string; fichier: string; colonne: number }>('/revue', { projectId, premise, fichier, colonne, ...(retirer ? { retirer: true } : {}) }),
  ontology: (projectId: string) => request<OntologyState>(`/ontologie?projectId=${encodeURIComponent(projectId)}`),
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

export type Evidence = { piece: string; resource: string; label: string; value: string; citation: string; origin: string; at?: string; author?: 'human' | 'agent'; review?: string };

export function entityEvidence(index: OkfIndex, entityId: string): Evidence[] {
  const fiche = index.fiches.find((entry) => entry.id === entityId);
  const byId = (id: string) => index.fiches.find((entry) => entry.id === id);
  const evidence = (owner: OkfFiche, entry: OkfRelation, label: string) => {
    const piece = byId(pieceOf(owner, entry));
    return piece ? [{ piece: piece.title, resource: piece.resource, label, value: entry.value || '', citation: entry.citation, origin: entry.origin, at: entry.at }] : [];
  };
  const outgoing = (fiche?.relations || []).flatMap((entry) => evidence(fiche!, entry, entry.value ? entry.relation : `${entry.relation} → ${byId(entry.target)?.title || entry.target}`));
  const incoming = index.fiches.flatMap((other) => other.relations.filter((entry) => entry.target === entityId && other.id !== entityId).flatMap((entry) => evidence(other, entry, `${other.title} · ${entry.relation}`)));
  const reviewed = (fiche?.revues || []).flatMap((review) => review.lignes.map((row) => ({
    piece: index.fiches.find((entry) => entry.resource === row.resource)?.title || row.label, resource: row.resource, label: '', value: row.value, citation: row.citation, origin: 'piecemaker/tabular-review', at: row.checkedAt, author: row.author, review: review.titre,
  })));
  return [...outgoing, ...incoming, ...reviewed];
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

export function spreadBoxes(boxes: Array<{ x: number; y: number; w: number; h: number }>, gap: number, gapY = gap, rounds = 300): void {
  for (let round = 0; round < rounds; round += 1) {
    let moved = false;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 + gapY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX < overlapY) {
          const push = (overlapX / 2) * (dx < 0 ? -1 : 1);
          a.x -= push; b.x += push;
        } else {
          const push = (overlapY / 2) * (dy < 0 ? -1 : 1);
          a.y -= push; b.y += push;
        }
      }
    }
    if (!moved) return;
  }
}

export type OkfGraph = { center: () => void; destroy: () => void; select: (id: string | null) => void };

export async function mountGraph(container: HTMLElement, index: OkfIndex, withEntities: boolean, onOpen: (fiche: OkfFiche) => void): Promise<OkfGraph> {
  const { default: cytoscape } = await import('cytoscape');
  const paint = document.createElement('canvas').getContext('2d');
  const style = getComputedStyle(container);
  const color = (name: string, fallback: string) => {
    if (!paint) return fallback;
    paint.fillStyle = fallback;
    paint.fillStyle = style.getPropertyValue(name).trim() || fallback;
    return String(paint.fillStyle);
  };
  const text = color('--pmd-text', '#374151');
  const muted = color('--pmd-muted', '#6b7280');
  const border = color('--pmd-border', '#e5e7eb');
  const surface = color('--pmd-surface', '#ffffff');
  const accent = color('--pmd-accent', '#0088ff');
  const fontFamily = style.fontFamily || 'sans-serif';
  const measure = document.createElement('canvas').getContext('2d');
  if (measure) measure.font = `500 12px ${fontFamily}`;
  const elements = graphElements(index, withEntities).map((element) => {
    if (element.data.source) return element;
    const label = element.data.label;
    const width = Math.max(96, Math.min(200, (measure?.measureText(label).width || label.length * 7) + 54));
    const svg = iconSvg(element.data.icon, text);
    return { data: { ...element.data, width, image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` } };
  });
  const graph = cytoscape({
    container,
    elements,
    autoungrabify: true,
    minZoom: 0.1,
    maxZoom: 1.5,
    layout: { name: 'cose', animate: false, randomize: true, padding: 24, nodeDimensionsIncludeLabels: true, nodeRepulsion: () => 90000, nodeOverlap: 20, idealEdgeLength: () => 90, edgeElasticity: () => 120, gravity: 0.8, componentSpacing: 50, numIter: 2500 },
    style: [
      { selector: 'node', style: { label: 'data(label)', shape: 'round-rectangle', 'corner-radius': '18px', width: 'data(width)', height: 36, 'background-color': surface, 'border-width': 1, 'border-color': border, color: text, 'font-family': fontFamily, 'font-size': 12, 'font-weight': 500, 'text-valign': 'center', 'text-halign': 'center', 'text-margin-x': 12, 'text-wrap': 'ellipsis', 'text-max-width': '150px', 'background-image': 'data(image)', 'background-width': 17, 'background-height': 17, 'background-position-x': '13px', 'background-position-y': '50%', 'background-fit': 'none', 'transition-property': 'opacity, border-width', 'transition-duration': 120 } },
      { selector: 'edge', style: { width: 1, 'line-color': border, 'target-arrow-color': muted, 'target-arrow-shape': 'none', 'arrow-scale': 0.7, 'curve-style': 'bezier', 'line-style': 'solid', label: '', color: muted, 'font-family': fontFamily, 'font-size': 10, 'text-rotation': 'autorotate', 'text-background-color': surface, 'text-background-opacity': 0.95, 'text-background-padding': '4px', 'text-background-shape': 'roundrectangle', 'transition-property': 'opacity, width', 'transition-duration': 120 } },
      { selector: 'node[kind = "premise"]', style: { 'border-color': color('--pmd-premise', '#d6cbef'), 'border-width': 2 } },
      { selector: 'node[kind = "party-client"]', style: { 'border-color': color('--pmd-client', '#a8d5b5'), 'border-width': 2 } },
      { selector: 'node[kind = "party-adverse"]', style: { 'border-color': color('--pmd-adverse', '#efb4b4'), 'border-width': 2 } },
      { selector: 'node[kind = "party-tiers"]', style: { 'border-color': color('--pmd-tiers', '#b3cdee'), 'border-width': 2 } },
      { selector: '.pmd-dim', style: { opacity: 0.15 } },
      { selector: 'edge.pmd-near', style: { width: 1.5, label: 'data(label)', 'target-arrow-shape': 'triangle', 'line-color': muted, 'target-arrow-color': muted, color: text } },
      { selector: 'node.pmd-near', style: { 'border-width': 1.5 } },
      { selector: 'node:selected', style: { 'border-width': 1.5, 'border-color': accent, 'overlay-color': accent, 'overlay-opacity': 0.08, 'overlay-padding': 6 } },
    ],
  });
  const focusOn = (node: cytoscape.NodeSingular | null) => {
    graph.elements().removeClass('pmd-dim pmd-near');
    if (!node) return;
    const near = node.closedNeighborhood();
    graph.elements().not(near).addClass('pmd-dim');
    near.addClass('pmd-near');
  };
  const selectedNode = () => graph.nodes(':selected').first();
  graph.on('mouseover', 'node', (event) => focusOn(event.target));
  graph.on('mouseout', 'node', () => focusOn(selectedNode().nonempty() ? selectedNode() : null));
  graph.on('tap', 'node', (event) => {
    focusOn(event.target);
    const fiche = index.fiches.find((entry) => entry.id === String(event.target.id()));
    if (fiche) onOpen(fiche);
  });
  graph.on('tap', (event) => {
    if (event.target === graph) focusOn(null);
  });
  const nodes = graph.nodes();
  const extent = nodes.boundingBox();
  const area = 3 * nodes.reduce((sum, node) => sum + node.outerWidth() * node.outerHeight(), 0);
  const width = Math.sqrt(area * (container.clientWidth && container.clientHeight ? container.clientWidth / container.clientHeight : 4 / 3));
  const boxes = nodes.map((node) => ({ x: (node.position('x') - extent.x1) * width / (extent.w || 1), y: (node.position('y') - extent.y1) * (area / width) / (extent.h || 1), w: node.outerWidth(), h: node.outerHeight() }));
  spreadBoxes(boxes, 24, 12);
  nodes.forEach((node, at) => { node.position({ x: boxes[at].x, y: boxes[at].y }); });
  let focus: cytoscape.Collection | null = null;
  const fitView = () => { graph.resize(); graph.fit(focus ?? undefined, focus ? 40 : 24); };
  const center = () => { focus = null; fitView(); };
  center();
  const resize = new ResizeObserver(fitView);
  resize.observe(container);
  const select = (id: string | null) => {
    graph.nodes(':selected').unselect();
    const node = id ? graph.getElementById(id) : null;
    if (node?.nonempty()) node.select();
    focusOn(node?.nonempty() ? node : null);
    focus = node?.nonempty() ? node.closedNeighborhood() : null;
    fitView();
  };
  return { center, destroy: () => { resize.disconnect(); graph.destroy(); }, select };
}
