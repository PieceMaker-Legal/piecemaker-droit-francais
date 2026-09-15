import { NODE_KINDS } from './types.js';
import type { KnowledgeLink, KnowledgeNode, KnowledgeSnapshot, NodeKind } from './types.js';
import type { KnowledgeChronologyView, KnowledgeMappingView, KnowledgeOverview } from './api.js';

export type Tab = 'general' | 'chronology' | 'graph';
export type ViewData = {
  overview: KnowledgeOverview;
  mapping: KnowledgeMappingView;
  chronology: KnowledgeChronologyView;
  graph: KnowledgeSnapshot;
};

export type AgentsViewerState = {
  open: boolean;
  loading: boolean;
  content: string;
  exists: boolean;
  error: string;
};

export const labels: Record<NodeKind, string> = {
  person: 'Personnes physiques',
  company: 'Personnes morales',
  document: 'Documents',
  iban: 'IBAN',
  address: 'Adresses',
  phone: 'Téléphones',
  email: 'E-mails',
  url: 'URL',
  siren: 'SIREN',
  other: 'Autres',
};

export const entityKinds = NODE_KINDS.filter((kind) => kind !== 'document');
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
export const textValue = (value: unknown): string => typeof value === 'string' ? value : '';
export const dateFor = (node: KnowledgeNode): string => textValue(node.data.doc_date_iso) || textValue(node.data.dateIso) || '';

const userIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 21a8 8 0 0 0-16 0"></path><circle cx="10" cy="7" r="4"></circle><path d="M22 21a8 8 0 0 0-5-7.7"></path></svg>';
const companyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4c0-.5.4-1 1-1h10c.6 0 1 .5 1 1v18"></path><path d="M6 12H4c-.6 0-1 .4-1 1v9"></path><path d="M18 9h2c.6 0 1 .4 1 1v12"></path><path d="M10 6h4M10 10h4M10 14h4M10 18h4"></path></svg>';
const tagIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.8A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .8 1.4l8.5 8.5a2.4 2.4 0 0 0 3.4 0l6.4-6.4a2.4 2.4 0 0 0 0-3.4z"></path><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"></circle></svg>';
const moreIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';

function profileKind(node: KnowledgeNode): { label: string; icon: string; kind: string } {
  if (node.kind === 'person') return { label: 'Personne physique', icon: userIcon, kind: 'person' };
  if (node.kind === 'company') return { label: 'Personne morale', icon: companyIcon, kind: 'company' };
  return { label: labels[node.kind].replace(/s$/, ''), icon: tagIcon, kind: 'other' };
}

function positionLabel(node: KnowledgeNode): string {
  const position = textValue(node.data.position);
  const labelsByPosition: Record<string, string> = { demandeur: 'Demandeur', defendeur: 'Défendeur', appelant: 'Appelant', intime: 'Intimé', requerant: 'Requérant', mis_en_cause: 'Mis en cause', intervenant: 'Intervenant' };
  return labelsByPosition[position] || position || (node.data.partySide === 'client' ? 'Demandeur' : 'Défendeur');
}

function nodeCard(node: KnowledgeNode, graph: KnowledgeSnapshot): string {
  const side = textValue(node.data.partySide);
  const nodesById = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  const relations = graph.links.filter((link) => {
    if (link.fromNodeId !== node.id && link.toNodeId !== node.id) return false;
    const other = nodesById.get(link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId);
    return link.relation !== 'mentions' && (other?.kind === 'person' || other?.kind === 'company');
  });
  const kind = profileKind(node);
  const accent = side === 'client' ? 'client' : side === 'adversaire' ? 'adverse' : 'neutral';
  return `
    <article class="pmd-profile-card" data-side="${accent}" draggable="true" data-profile-id="${escapeHtml(node.id)}">
      <div class="pmd-profile-accent"></div>
      <div class="pmd-card-head">
        <span class="pmd-kind-icon" data-kind="${kind.kind}">${kind.icon}</span>
        <div class="pmd-profile-heading"><div class="pmd-card-title">${escapeHtml(node.label || 'Sans libellé')}</div><div class="pmd-profile-kind">${escapeHtml(kind.label)} · ${Math.max(1, node.aliases.length + 1)} écriture${node.aliases.length ? 's' : ''} détectée${node.aliases.length ? 's' : ''}</div></div>
        <div class="pmd-profile-menu-wrap">
          <button class="pmd-profile-menu-trigger" data-node-menu aria-label="Options pour ${escapeHtml(node.label)}">${moreIcon}</button>
          <div class="pmd-profile-menu"><button data-edit-node="${escapeHtml(node.id)}">${userIcon}<span>Modifier</span></button><button class="pmd-menu-danger" data-delete-node="${escapeHtml(node.id)}">×<span>Supprimer</span></button></div>
        </div>
      </div>
      <div class="pmd-party-line"><span class="pmd-party-badge" data-side="${accent}">${side === 'client' ? 'Partie cliente' : 'Partie adverse'} · ${escapeHtml(positionLabel(node))}</span></div>
      <div class="pmd-relations-box" data-relation-drop="${escapeHtml(node.id)}">
        ${relations.length ? relations.map((link) => {
          const otherId = link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId;
          const other = nodesById.get(otherId);
          return `<div class="pmd-related"><div><span>Profil lié</span><strong>${escapeHtml(other?.label || otherId)}</strong><small>${escapeHtml(link.relation)}</small></div><button data-unlink-from="${escapeHtml(link.fromNodeId)}" data-unlink-to="${escapeHtml(link.toNodeId)}" data-unlink-relation="${escapeHtml(link.relation)}" aria-label="Supprimer le lien">×</button></div>`;
        }).join('<div class="pmd-related-separator"></div>') : '<div class="pmd-relation-empty">Glissez un profil ici<br>pour établir un lien</div>'}
        ${relations.length ? '<div class="pmd-drop-hint">Glissez un autre profil ici pour ajouter un lien</div>' : ''}
      </div>
    </article>`;
}

const shieldCheckIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg>';
const scanSearchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><circle cx="12" cy="12" r="3"></circle><path d="m16 16-1.9-1.9"></path></svg>';

export function shell(active: Tab, mappingCount = 0, scanning = false, agentsViewer?: AgentsViewerState): string {
  return `
    <div class="pmd-header">
      <div class="pmd-tabs" role="tablist">
        <button class="pmd-tab" data-tab="general" aria-selected="${active === 'general'}">Général</button>
        <button class="pmd-tab" data-tab="chronology" aria-selected="${active === 'chronology'}">Chronologie</button>
        <button class="pmd-tab" data-tab="graph" aria-selected="${active === 'graph'}">Graphe</button>
      </div>
      <div class="pmd-scan-status" data-ready="${mappingCount > 0}">
        <span class="pmd-status-icon">${shieldCheckIcon}</span>
        <span class="pmd-status-label">${mappingCount} anonymisé(s)</span>
        <button class="pmd-scan-button" data-action="scan" ${scanning ? 'disabled' : ''}>${scanSearchIcon}<span>${scanning ? 'Analyse en cours…' : mappingCount > 0 ? 'Relancer' : 'Lancer'}</span></button>
      </div>
      <button class="pmd-button pmd-agents-button" data-action="agents"><span>▤</span> Agents.md</button>
    </div>
    <div data-error></div>
    <div class="pmd-workspace"><main class="pmd-content" data-content></main>${agentsViewer?.open ? agentsView(agentsViewer) : ''}</div>`;
}

export function generalView(data: ViewData): string {
  const entities = data.graph.nodes.filter((node) => node.kind !== 'document');
  const clients = entities.filter((node) => node.data.partySide === 'client');
  const adversaries = entities.filter((node) => node.data.partySide === 'adversaire');
  return `
    <div class="pmd-general">
    <div class="pmd-general-actions">
      <button class="pmd-button pmd-small-button" data-action="mapping">${tagIcon} Mapping</button>
      <button class="pmd-button pmd-small-button" data-action="add-node">＋ Ajouter une partie</button>
    </div>
    ${clients.length || adversaries.length ? `<div class="pmd-party-columns">
      <section class="pmd-party-column"><h3 data-side="client">Parties clientes</h3>${clients.length ? clients.map((node) => nodeCard(node, data.graph)).join('') : '<button type="button" class="pmd-column-empty" data-party-picker="client"><span>Aucune partie cliente désignée.</span><small>Cliquer pour ajouter une partie</small></button>'}</section>
      <section class="pmd-party-column"><h3 data-side="adverse">Parties adverses</h3>${adversaries.length ? adversaries.map((node) => nodeCard(node, data.graph)).join('') : '<button type="button" class="pmd-column-empty" data-party-picker="adversaire"><span>Aucune partie adverse désignée.</span><small>Cliquer pour ajouter une partie</small></button>'}</section>
    </div>` : `<div class="pmd-no-parties">${shieldCheckIcon}<h3>Aucune partie désignée</h3><p>Ouvrez le mapping pour désigner une entité détectée comme partie, ou ajoutez une partie.</p><button class="pmd-button" data-action="mapping">◇ Ouvrir le mapping</button></div>`}
    <div class="pmd-sticky-status">
      <span>Glissez un profil sur un autre pour créer un lien.</span>
      <button class="pmd-button pmd-button-primary pmd-small-button" data-action="refresh">✓ Enregistrer les profils</button>
    </div>
    </div>
  `;
}

export function mappingView(data: ViewData): string {
  const entries = data.graph.nodes.filter((node) => node.kind !== 'document');
  const categories = entityKinds.map((kind) => ({ kind, label: labels[kind], entries: entries.filter((node) => node.kind === kind) })).filter((category) => category.entries.length);
  const exclusions = data.mapping.exclusions || data.graph.exclusions || [];
  return `<div class="pmd-mapping-dialog"><div class="pmd-mapping-header"><h2>Mapping de pseudonymisation</h2><button class="pmd-icon-button" data-close>×</button></div><div class="pmd-mapping-body"><p>Chaque ligne associe une clé de pseudonymisation au variant principal rétabli lors du revert et aux autres écritures détectées.</p>${categories.map((category) => `<section class="pmd-mapping-category"><header><h3>${escapeHtml(category.label)} <span>${category.entries.length}</span></h3><button data-action="add-node">＋ Ajouter</button></header><div>${category.entries.map((node) => {
    const mappings = data.graph.mappings.filter((mapping) => mapping.nodeId === node.id);
    return `<button class="pmd-mapping-row" data-edit-node="${escapeHtml(node.id)}"><span>${escapeHtml(mappings[0]?.masked || textValue(node.data.code) || node.id)}</span><span>${escapeHtml(node.label)}</span><span>${escapeHtml(node.aliases.join(', ') || 'Aucun autre variant')}</span><span>✎</span></button>`;
  }).join('')}</div></section>`).join('') || '<div class="pmd-empty">Aucune entité détectée.</div>'}<section class="pmd-mapping-category pmd-exclusions"><header><h3>Éléments exclus <span>${exclusions.length}</span></h3></header>${exclusions.length ? `<div class="pmd-exclusion-list">${exclusions.map((value) => `<span>${escapeHtml(value)}<button data-remove-exclusion="${escapeHtml(value)}" aria-label="Réintégrer ${escapeHtml(value)}">×</button></span>`).join('')}</div>` : '<div class="pmd-column-empty">Aucun élément exclu.</div>'}</section></div><div class="pmd-mapping-footer"><button class="pmd-button" data-close>Fermer</button><button class="pmd-button pmd-button-primary" data-close>✓ Enregistrer le mapping</button></div></div>`;
}

function agentsView(state: AgentsViewerState): string {
  const body = state.loading
    ? '<div class="pmd-viewer-empty">Chargement d’AGENTS.md…</div>'
    : state.error
      ? `<div class="pmd-viewer-error">${escapeHtml(state.error)}</div>`
      : `<pre class="pmd-code">${escapeHtml(state.exists ? state.content : 'Aucun fichier AGENTS.md dans ce dossier.')}</pre>`;
  return `<aside class="pmd-file-viewer" aria-label="Visionneuse AGENTS.md"><header><div><strong>AGENTS.md</strong><span>Fichier du dossier actif</span></div><button class="pmd-icon-button" data-action="close-agents" aria-label="Fermer">×</button></header><div class="pmd-file-body">${body}</div></aside>`;
}

function chronologyDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function chronologyFields(node: KnowledgeNode): string {
  const fields = Array.isArray(node.data.fields) ? node.data.fields : [];
  const entries = fields.filter((field): field is { label: string; value: string } => Boolean(field) && typeof field === 'object' && typeof (field as { label?: unknown }).label === 'string' && typeof (field as { value?: unknown }).value === 'string');
  return entries.length ? `<dl class="pmd-document-fields">${entries.map((field) => `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`).join('')}</dl>` : '';
}

function chronologyEvent(node: KnowledgeNode, dated: boolean, byId: Map<string, KnowledgeNode>, links: KnowledgeLink[]): string {
  const related = links
    .filter((link) => link.relation === 'mentions' && (link.fromNodeId === node.id || link.toNodeId === node.id))
    .map((link) => byId.get(link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId))
    .filter((entry): entry is KnowledgeNode => Boolean(entry && entry.kind !== 'document'));
  const nature = textValue(node.data.nature);
  const localisation = textValue(node.data.localisation);
  return `<article class="pmd-chronology-event" data-dated="${dated}" data-open-document="${escapeHtml(node.id)}"><div class="pmd-chronology-marker" aria-hidden="true"></div><div class="pmd-chronology-date">${escapeHtml(dated ? chronologyDateLabel(dateFor(node)) : 'Date non renseignée')}</div><div class="pmd-chronology-document pmd-card"><div class="pmd-card-head"><div class="pmd-document-heading"><div class="pmd-card-title">${escapeHtml(node.label)}</div><div class="pmd-document-meta">${escapeHtml(nature || 'Type non renseigné')}${localisation ? ` · ${escapeHtml(localisation)}` : ''}</div></div><button class="pmd-icon-button" data-edit-document="${escapeHtml(node.id)}" aria-label="Modifier ${escapeHtml(node.label)}" title="Modifier le document">✎</button></div>${chronologyFields(node)}<div class="pmd-document-related"><span class="pmd-document-related-label">Personnes liées</span><div class="pmd-badges">${related.map((entry) => `<span class="pmd-badge">${escapeHtml(entry.label)}</span>`).join('') || '<span class="pmd-badge pmd-badge-muted">Aucune personne liée</span>'}</div></div></div></article>`;
}

function chronologySection(title: string, hint: string, nodes: KnowledgeNode[], dated: boolean, byId: Map<string, KnowledgeNode>, links: KnowledgeLink[]): string {
  if (!nodes.length) return '';
  return `<section class="pmd-chronology-section"><div class="pmd-chronology-section-heading"><div><h3>${title}</h3><p>${hint}</p></div><span class="pmd-section-count">${nodes.length}</span></div><div class="pmd-timeline">${nodes.map((node) => chronologyEvent(node, dated, byId, links)).join('')}</div></section>`;
}

function renderChronologySections(dated: KnowledgeNode[], undated: KnowledgeNode[], byId: Map<string, KnowledgeNode>, links: KnowledgeLink[] = []): string {
  const total = dated.length + undated.length;
  if (!total) return '<div class="pmd-empty">Aucun document indexé.</div>';
  const stats = `<div class="pmd-summary"><div class="pmd-metric"><strong>${total}</strong><span>pièce${total > 1 ? 's' : ''} indexée${total > 1 ? 's' : ''}</span></div><div class="pmd-metric"><strong>${dated.length}</strong><span>pièce${dated.length > 1 ? 's' : ''} datée${dated.length > 1 ? 's' : ''}</span></div><div class="pmd-metric"><strong>${undated.length}</strong><span>date${undated.length > 1 ? 's' : ''} à préciser</span></div></div>`;
  return `${stats}${chronologySection('Documents datés', 'Classés du plus ancien au plus récent', dated, true, byId, links)}${chronologySection('Documents sans date', 'À compléter depuis la fiche de la pièce', undated, false, byId, links)}`;
}

export function chronologyView(data: ViewData): string {
  const dated = data.chronology.documents
    .filter((node) => Boolean(dateFor(node)))
    .sort((left, right) => dateFor(left).localeCompare(dateFor(right)) || left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));
  const undated = data.chronology.documents
    .filter((node) => !dateFor(node))
    .sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));
  const byId = new Map(data.graph.nodes.map((node) => [node.id, node]));
  return `
    <div class="pmd-toolbar"><div><h2 class="pmd-title">Chronologie</h2><div class="pmd-subtitle">Documents et personnes liées</div></div><span class="pmd-spacer"></span><button class="pmd-button" data-action="refresh">Rafraîchir</button></div>
    ${renderChronologySections(dated, undated, byId, data.graph.links)}`;
}

export type NetworkGraphData = {
  nodes: Array<{ id: string; label: string; group: string; level: number; title: string }>;
  edges: Array<{ id: string; from: string; to: string; label: string }>;
};

function networkGroup(node: KnowledgeNode): string {
  if (node.data.partySide === 'client') return 'client';
  if (node.data.partySide === 'adversaire') return 'adverse';
  if (node.kind === 'document') return 'document';
  if (node.kind === 'person') return 'person';
  if (node.kind === 'company') return 'company';
  if (node.kind === 'iban' || node.kind === 'siren') return 'financial';
  return 'detail';
}

export function networkGraphData(snapshot: KnowledgeSnapshot): NetworkGraphData {
  const nodes = snapshot.nodes.map((node) => {
    const group = networkGroup(node);
    const level = node.kind === 'document' ? 0 : group === 'client' || group === 'adverse' ? 1 : 2;
    return { id: node.id, label: node.label, group, level, title: `${labels[node.kind]} · ${node.label}` };
  });
  const edges = snapshot.links.map((link, index) => ({ id: `${index}:${link.fromNodeId}:${link.toNodeId}:${link.relation}`, from: link.fromNodeId, to: link.toNodeId, label: link.relation }));
  return { nodes, edges };
}

export function graphView(): string {
  return `<div class="pmd-toolbar"><div><h2 class="pmd-title">Graphe du dossier</h2><div class="pmd-subtitle">Déplacez, zoomez ou sélectionnez un élément</div></div></div><div class="pmd-network-frame" data-network-frame><div class="pmd-network-actions"><button class="pmd-button" data-action="fit-network">Recentrer</button><button class="pmd-button pmd-button-primary" data-action="fullscreen-network">Plein écran</button></div><div class="pmd-network" data-network></div><div class="pmd-network-help">Molette pour zoomer · Glisser pour déplacer · Double-clic pour modifier</div></div>`;
}
