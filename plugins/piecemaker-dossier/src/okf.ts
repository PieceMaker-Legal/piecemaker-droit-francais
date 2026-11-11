export type OkfRelation = { relation: string; target: string; citation: string; origin: string; value?: string };
export type OkfFiche = { id: string; type: string; title: string; description: string; resource: string; date: string; side?: string; single?: boolean; relations: OkfRelation[] };
export type OkfIndex = { types: string[]; typesGraphe: string[]; fiches: OkfFiche[] };
export type OkfError = { fiche: string; erreur: string };
export type OkfContradiction = { premise: string; titre: string; valeurs: Array<{ piece: string; valeur: string }> };
export type OkfReport = { erreurs: OkfError[]; contradictions: OkfContradiction[] };
export type OkfView = { index: OkfIndex | null; mode: 'table' | 'graph'; errors: OkfError[] | null; contradictions?: OkfContradiction[] };
export type OkfLink = { source: string; relation: string; target: string; citation?: string; value?: string };

export const PREMISE_TYPE = 'Premise';
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

export type PremiseStatement = { premise: string; title: string; citation: string; value: string };

export function premiseStatements(index: OkfIndex | null, resource: string): PremiseStatement[] {
  const fiche = index?.fiches.find((entry) => entry.resource === resource.normalize('NFC'));
  if (!index || !fiche) return [];
  return fiche.relations
    .filter((entry) => entry.relation === 'states')
    .map((entry) => ({ premise: entry.target, title: index.fiches.find((other) => other.id === entry.target)?.title || entry.target, citation: entry.citation, value: entry.value || '' }));
}

export function premises(index: OkfIndex | null): OkfFiche[] {
  return (index?.fiches || []).filter((fiche) => fiche.type === PREMISE_TYPE).sort((left, right) => left.title.localeCompare(right.title, 'fr', { sensitivity: 'base' }));
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
  const fiches = index.fiches.filter((fiche) => [...index.typesGraphe, PREMISE_TYPE, PARTY_TYPE].includes(fiche.type));
  const ids = new Set(fiches.map((fiche) => fiche.id));
  const kind = (fiche: OkfFiche) => fiche.type === PREMISE_TYPE ? 'premise' : fiche.type === PARTY_TYPE ? `party-${fiche.side === 'adversaire' ? 'adverse' : fiche.side || 'tiers'}` : 'document';
  return [
    ...fiches.map((fiche) => ({ data: { id: fiche.id, label: fiche.title, resource: fiche.resource, kind: kind(fiche), type: fiche.type } })),
    ...fiches.flatMap((fiche) => fiche.relations
      .filter((entry) => ids.has(entry.target))
      .map((entry) => ({ data: { id: `${fiche.id}|${entry.relation}|${entry.target}`, source: fiche.id, target: entry.target, label: RELATION_LABELS[entry.relation] || entry.relation, relation: entry.relation } }))),
  ];
}

export function premiseEstablishers(index: OkfIndex, premiseId: string): Array<{ piece: string; resource: string; value: string; citation: string }> {
  return index.fiches.flatMap((fiche) => fiche.relations
    .filter((entry) => entry.relation === 'states' && entry.target === premiseId)
    .map((entry) => ({ piece: fiche.title, resource: fiche.resource, value: entry.value || '', citation: entry.citation })));
}

export function premiseParties(index: OkfIndex, premiseId: string): OkfFiche[] {
  const targets = new Set((index.fiches.find((fiche) => fiche.id === premiseId)?.relations || []).filter((entry) => entry.relation === 'involves').map((entry) => entry.target));
  return index.fiches.filter((fiche) => fiche.type === PARTY_TYPE && targets.has(fiche.id));
}

export function partyPremises(index: OkfIndex | null, code: string): OkfFiche[] {
  const party = index?.fiches.find((fiche) => fiche.type === PARTY_TYPE && fiche.title === code);
  if (!party) return [];
  return premises(index).filter((fiche) => fiche.relations.some((entry) => entry.relation === 'involves' && entry.target === party.id));
}

const escapeText = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
const premiseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 9-9 9-9-9z"></path></svg>';
const pieceIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path></svg>';
const partyIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="4"></circle><path d="M5 20v-2a7 7 0 0 1 14 0v2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"></path></svg>';

export function premiseFicheMarkup(index: OkfIndex, premiseId: string): string {
  const premise = index.fiches.find((fiche) => fiche.id === premiseId);
  if (!premise) return '';
  const pieces = premiseEstablishers(index, premiseId).map((entry) => `<button type="button" class="pmd-relation-row pmd-relation-open" data-open-resource="${escapeText(entry.resource)}"><span class="pmd-relation-copy">${entry.value ? `<span class="pmd-relation-type">${escapeText(entry.value)}</span>` : ''}<strong class="pmd-relation-target">${escapeText(entry.piece)}</strong>${entry.citation ? `<small class="pmd-relation-kind pmd-relation-quote">« ${escapeText(entry.citation)} »</small>` : ''}</span></button>`).join('');
  const parties = premiseParties(index, premiseId).map((party) => `<div class="pmd-relation-row"><span class="pmd-relation-copy"><span class="pmd-relation-type">${escapeText(party.description)}</span><strong class="pmd-relation-target">${escapeText(party.title)}</strong></span></div>`).join('');
  return `<div class="pmd-profile-editor" data-kind="premise" data-side="premise"><div class="pmd-form">
    <header class="pmd-profile-identity"><span class="pmd-profile-avatar">${premiseIcon}</span><div class="pmd-profile-identity-copy"><span class="pmd-profile-eyebrow">Prémisse</span><strong>${escapeText(premise.title)}</strong>${premise.single ? '<span class="pmd-profile-kind">Valeur unique</span>' : ''}</div><button type="button" class="pmd-icon-button pmd-profile-close" data-close aria-label="Fermer">×</button></header>
    ${premise.description ? `<section class="pmd-form-section pmd-profile-section"><h3>${premiseIcon}Description</h3><p class="pmd-form-note">${escapeText(premise.description)}</p></section>` : ''}
    <section class="pmd-form-section pmd-profile-section"><h3>${pieceIcon}Pièces qui établissent cette prémisse</h3>${pieces ? `<div class="pmd-relation-list">${pieces}</div>` : '<p class="pmd-form-note">Aucune pièce n’établit cette prémisse.</p>'}</section>
    ${parties ? `<section class="pmd-form-section pmd-profile-section"><h3>${partyIcon}Parties concernées</h3><div class="pmd-relation-list">${parties}</div></section>` : ''}
    <div class="pmd-form-actions"><button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-premise-review title="Crée une revue tabulaire dont la colonne porte cette prémisse">Revue tabulaire</button><button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Fermer</button></div>
  </div></div>`;
}

export function premiseReviewDraft(index: OkfIndex, premiseId: string, project: string) {
  const premise = index.fiches.find((fiche) => fiche.id === premiseId);
  if (!premise) return null;
  return { project, title: premise.title, templateName: '', columns: [{ name: premise.title, prompt: premise.description || premise.title, format: 'text', premise: premise.single ? 'single' : 'checkpoint' }], rows: [] };
}

export async function mountGraph(container: HTMLElement, index: OkfIndex, onOpen: (fiche: OkfFiche) => void): Promise<() => void> {
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
    premise: [color('--pmd-premise', '#d6cbef'), color('--pmd-muted', '#6b7280')],
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
      { selector: 'node[kind = "premise"]', style: { shape: 'diamond', width: 32, height: 32, 'background-color': palette.premise[0], 'border-color': palette.premise[1] } },
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
  return () => graph.destroy();
}
