export type OkfRelation = { relation: string; target: string; citation: string; origin: string; value?: string };
export type OkfFiche = { id: string; type: string; title: string; description: string; resource: string; date: string; side?: string; single?: boolean; relations: OkfRelation[] };
export type OkfIndex = { types: string[]; typesGraphe: string[]; fiches: OkfFiche[] };
export type OkfError = { fiche: string; erreur: string };
export type OkfContradiction = { fait: string; titre: string; valeurs: Array<{ piece: string; valeur: string }> };
export type OkfReport = { erreurs: OkfError[]; contradictions: OkfContradiction[] };
export type OkfView = { index: OkfIndex | null; mode: 'table' | 'graph'; errors: OkfError[] | null; contradictions?: OkfContradiction[] };
export type OkfLink = { source: string; relation: string; target: string; citation?: string; value?: string };

export const FACT_TYPE = 'Fait';
export const PARTY_TYPE = 'Partie';
export const RELATION_LABELS: Record<string, string> = { amends: 'modifie', 'responds-to': 'répond à', 'refers-to': 'se réfère à', supersedes: 'remplace', states: 'établit', mentions: 'mentionne', involves: 'concerne' };
const INCOMING_LABELS: Record<string, string> = { amends: 'modifié par', 'responds-to': 'répondu par', 'refers-to': 'visé par', supersedes: 'remplacé par', states: 'établi par', mentions: 'mentionné par', involves: 'concerné par' };

async function request<T>(path: string, payload?: unknown): Promise<T> {
  const token = localStorage.getItem('auth-token');
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(`/api/piecemaker/okf${path}`, payload ? { method: 'POST', headers, body: JSON.stringify(payload) } : { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Index OKF indisponible (${response.status}).`);
  return body as T;
}

export const okfApi = {
  read: (projectId: string) => request<OkfIndex>(`?projectId=${encodeURIComponent(projectId)}`),
  verify: (projectId: string) => request<OkfReport>(`/verify?projectId=${encodeURIComponent(projectId)}`),
  link: (projectId: string, link: OkfLink) => request<OkfLink>('/link', { projectId, ...link }),
  unlink: (projectId: string, link: OkfLink) => request<OkfLink>('/unlink', { projectId, ...link }),
};

export type FactStatement = { fact: string; title: string; citation: string; value: string };

export function factStatements(index: OkfIndex | null, resource: string): FactStatement[] {
  const fiche = index?.fiches.find((entry) => entry.resource === resource.normalize('NFC'));
  if (!index || !fiche) return [];
  return fiche.relations
    .filter((entry) => entry.relation === 'states')
    .map((entry) => ({ fact: entry.target, title: index.fiches.find((other) => other.id === entry.target)?.title || entry.target, citation: entry.citation, value: entry.value || '' }));
}

export function facts(index: OkfIndex | null): OkfFiche[] {
  return (index?.fiches || []).filter((fiche) => fiche.type === FACT_TYPE).sort((left, right) => left.title.localeCompare(right.title, 'fr', { sensitivity: 'base' }));
}

const linkTitle = (entry: OkfRelation, title: string) => entry.value ? `${title} : ${entry.value}` : title;

export function ficheLinks(index: OkfIndex | null, resource: string): Array<{ label: string; title: string; citation: string }> {
  const fiche = index?.fiches.find((entry) => entry.resource === resource.normalize('NFC'));
  if (!index || !fiche) return [];
  const titleOf = (id: string) => index.fiches.find((entry) => entry.id === id)?.title || id;
  return [
    ...fiche.relations.map((entry) => ({ label: `${RELATION_LABELS[entry.relation] || entry.relation} →`, title: linkTitle(entry, titleOf(entry.target)), citation: entry.citation })),
    ...index.fiches.flatMap((other) => other.relations
      .filter((entry) => entry.target === fiche.id)
      .map((entry) => ({ label: `← ${INCOMING_LABELS[entry.relation] || entry.relation}`, title: other.title, citation: entry.citation }))),
  ];
}

export function graphElements(index: OkfIndex): Array<{ data: Record<string, string> }> {
  const fiches = index.fiches.filter((fiche) => [...index.typesGraphe, FACT_TYPE, PARTY_TYPE].includes(fiche.type));
  const ids = new Set(fiches.map((fiche) => fiche.id));
  const kind = (fiche: OkfFiche) => fiche.type === FACT_TYPE ? 'fact' : fiche.type === PARTY_TYPE ? `party-${fiche.side || 'tiers'}` : 'document';
  return [
    ...fiches.map((fiche) => ({ data: { id: fiche.id, label: fiche.title, resource: fiche.resource, kind: kind(fiche), type: fiche.type } })),
    ...fiches.flatMap((fiche) => fiche.relations
      .filter((entry) => ids.has(entry.target))
      .map((entry) => ({ data: { id: `${fiche.id}|${entry.relation}|${entry.target}`, source: fiche.id, target: entry.target, label: RELATION_LABELS[entry.relation] || entry.relation, relation: entry.relation } }))),
  ];
}

export function factEstablishers(index: OkfIndex, factId: string): Array<{ piece: string; value: string; citation: string }> {
  return index.fiches.flatMap((fiche) => fiche.relations
    .filter((entry) => entry.relation === 'states' && entry.target === factId)
    .map((entry) => ({ piece: fiche.title, value: entry.value || '', citation: entry.citation })));
}

const escapeText = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);

export function factDetailMarkup(index: OkfIndex, factId: string): string {
  const fact = index.fiches.find((fiche) => fiche.id === factId);
  if (!fact) return '';
  const rows = factEstablishers(index, factId).map((entry) => `<li><strong>${escapeText(entry.piece)}</strong>${entry.value ? ` : ${escapeText(entry.value)}` : ''}${entry.citation ? `<blockquote>${escapeText(entry.citation)}</blockquote>` : ''}</li>`).join('');
  return `<div class="pmd-okf-detail-head"><strong>${escapeText(fact.title)}</strong><button type="button" class="pmd-icon-button piecemaker-button piecemaker-button--icon" data-okf-detail-close aria-label="Fermer le détail">×</button></div><div class="pmd-okf-detail-label">Pièces qui établissent ce fait</div>${rows ? `<ul>${rows}</ul>` : '<p class="pmd-okf-detail-empty">Aucune pièce n’établit ce fait.</p>'}`;
}

export async function mountGraph(container: HTMLElement, index: OkfIndex, onOpen: (resource: string) => void): Promise<() => void> {
  const { default: cytoscape } = await import('cytoscape');
  const probe = document.createElement('span');
  container.appendChild(probe);
  const color = (name: string, fallback: string) => {
    probe.style.color = fallback;
    probe.style.color = `var(${name}, ${fallback})`;
    return getComputedStyle(probe).color || fallback;
  };
  const text = color('--pmd-text', '#1f2328');
  const muted = color('--pmd-muted', '#656d76');
  const border = color('--pmd-border', '#d0d7de');
  const surface = color('--pmd-surface', '#ffffff');
  const accent = color('--pmd-accent', '#0088ff');
  const palette = {
    document: [color('--pmd-tiers', '#b3cdee'), color('--pmd-tiers-ink', '#55759e')],
    fact: [color('--pmd-fact', '#d6cbef'), color('--pmd-muted', '#6b7280')],
    client: [color('--pmd-client', '#a8d5b5'), color('--pmd-client-ink', '#4e7a5c')],
    adverse: [color('--pmd-adverse', '#efb4b4'), color('--pmd-adverse-ink', '#9a5555')],
    tiers: [color('--pmd-tiers', '#b3cdee'), color('--pmd-tiers-ink', '#55759e')],
  };
  const fontFamily = getComputedStyle(container).fontFamily || 'sans-serif';
  probe.remove();
  const partyStyle = (side: 'client' | 'adverse') => ({ selector: `node[kind = "party-${side}"]`, style: { shape: 'ellipse', width: 34, height: 34, 'background-color': palette[side][0], 'border-color': palette[side][1] } });
  const graph = cytoscape({
    container,
    elements: graphElements(index),
    layout: { name: 'cose', animate: false, padding: 40, nodeDimensionsIncludeLabels: true, nodeRepulsion: () => 14000, idealEdgeLength: () => 130, componentSpacing: 90 },
    style: [
      { selector: 'node', style: { label: 'data(label)', shape: 'round-rectangle', width: 22, height: 28, 'background-color': palette.document[0], 'border-width': 2, 'border-color': palette.document[1], color: text, 'font-family': fontFamily, 'font-size': 11, 'font-weight': 500, 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 6, 'text-wrap': 'ellipsis', 'text-max-width': '120px', 'text-background-color': surface, 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'text-background-shape': 'roundrectangle', 'transition-property': 'opacity, border-width', 'transition-duration': 120 } },
      { selector: 'node[kind = "fact"]', style: { shape: 'diamond', width: 32, height: 32, 'background-color': palette.fact[0], 'border-color': palette.fact[1] } },
      partyStyle('client'),
      partyStyle('adverse'),
      { selector: 'node[kind = "party-tiers"]', style: { shape: 'ellipse', width: 34, height: 34, 'background-color': palette.tiers[0], 'border-color': palette.tiers[1] } },
      { selector: 'edge', style: { width: 1.25, 'line-color': border, 'target-arrow-color': border, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.9, 'curve-style': 'bezier', 'line-style': 'solid', label: 'data(label)', color: muted, 'font-family': fontFamily, 'font-size': 9, 'text-rotation': 'autorotate', 'text-background-color': surface, 'text-background-opacity': 0.9, 'text-background-padding': '2px', 'text-background-shape': 'roundrectangle', 'transition-property': 'opacity, width', 'transition-duration': 120 } },
      { selector: 'edge[relation = "mentions"], edge[relation = "involves"]', style: { 'line-style': 'dashed' } },
      { selector: 'edge[relation = "states"]', style: { width: 1.75 } },
      { selector: '.pmd-dim', style: { opacity: 0.15 } },
      { selector: 'edge.pmd-near', style: { width: 2.25, 'line-color': muted, 'target-arrow-color': muted, color: text } },
      { selector: 'node.pmd-near', style: { 'border-width': 3 } },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': accent, 'overlay-color': accent, 'overlay-opacity': 0.08, 'overlay-padding': 6 } },
    ],
  });
  const detail = container.parentElement?.querySelector<HTMLElement>('[data-okf-detail]') ?? null;
  const closeDetail = () => {
    if (detail) detail.hidden = true;
  };
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
    if (!detail) return;
    if (event.target.data('kind') === 'fact') {
      detail.innerHTML = factDetailMarkup(index, String(event.target.id()));
      detail.hidden = false;
    } else closeDetail();
  });
  graph.on('tap', (event) => {
    if (event.target !== graph) return;
    closeDetail();
    focusOn(null);
  });
  graph.on('tap', 'node[kind = "document"]', (event) => onOpen(String(event.target.data('resource'))));
  const onDetailClick = (event: Event) => {
    if (!(event.target as HTMLElement).closest('[data-okf-detail-close]')) return;
    closeDetail();
    graph.elements().unselect();
    focusOn(null);
  };
  detail?.addEventListener('click', onDetailClick);
  return () => {
    detail?.removeEventListener('click', onDetailClick);
    graph.destroy();
  };
}
