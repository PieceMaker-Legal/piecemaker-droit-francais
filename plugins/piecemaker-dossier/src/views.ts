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

function relationCount(nodeId: string, links: KnowledgeLink[]): number {
  return links.filter((link) => link.fromNodeId === nodeId || link.toNodeId === nodeId).length;
}

function nodeCard(node: KnowledgeNode, graph: KnowledgeSnapshot): string {
  const mappings = graph.mappings.filter((mapping) => mapping.nodeId === node.id);
  const side = textValue(node.data.partySide);
  const relations = graph.links.filter((link) => link.fromNodeId === node.id || link.toNodeId === node.id);
  const nodesById = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  const kindLabel = labels[node.kind].replace(/s$/, '');
  const accent = side === 'client' ? 'client' : side === 'adversaire' ? 'adverse' : 'neutral';
  return `
    <article class="pmd-profile-card" data-side="${accent}">
      <div class="pmd-profile-accent"></div>
      <div class="pmd-card-head">
        <span class="pmd-kind-icon" data-kind="${escapeHtml(node.kind)}">${node.kind === 'company' ? '▦' : node.kind === 'person' ? '♙' : '◇'}</span>
        <div class="pmd-profile-heading"><div class="pmd-card-title">${escapeHtml(node.label || 'Sans libellé')}</div><div class="pmd-profile-kind">${escapeHtml(kindLabel)} · ${Math.max(1, node.aliases.length + 1)} écriture${node.aliases.length ? 's' : ''} détectée${node.aliases.length ? 's' : ''}</div></div>
        <div class="pmd-card-actions">
          <button class="pmd-icon-button" data-edit-node="${escapeHtml(node.id)}" aria-label="Modifier">✎</button>
          <button class="pmd-icon-button pmd-button-danger" data-delete-node="${escapeHtml(node.id)}" aria-label="Supprimer">×</button>
        </div>
      </div>
      <div class="pmd-party-line">${side ? `<span class="pmd-party-badge" data-side="${accent}">${side === 'client' ? 'Partie cliente' : 'Partie adverse'}${node.kind === 'company' && textValue(node.data.legalForm) ? ` · ${escapeHtml(node.data.legalForm)}` : ''}</span>` : '<span class="pmd-no-party">Aucune position procédurale</span>'}</div>
      <div class="pmd-relations-box">
        ${relations.length ? relations.map((link) => {
          const otherId = link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId;
          const other = nodesById.get(otherId);
          return `<div class="pmd-related"><div><span>${escapeHtml(link.relation)}</span><strong>${escapeHtml(other?.label || otherId)}</strong></div></div>`;
        }).join('') : '<div class="pmd-relation-empty">Aucun profil lié</div>'}
      </div>
      <div class="pmd-mapping-line">${mappings.map((mapping) => `<span>${escapeHtml(mapping.real)} → <strong>${escapeHtml(mapping.masked)}</strong></span>`).join('') || '<span>Aucun mapping</span>'}<span>${relationCount(node.id, graph.links)} lien(s)</span></div>
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
  const others = entities.filter((node) => node.data.partySide !== 'client' && node.data.partySide !== 'adversaire');
  return `
    <div class="pmd-general-actions">
      <button class="pmd-button" data-action="refresh">Rafraîchir</button>
      <button class="pmd-button" data-action="mapping">◇ Mapping</button>
      <button class="pmd-button" data-action="add-node">＋ Ajouter une partie</button>
    </div>
    ${clients.length || adversaries.length ? `<div class="pmd-party-columns">
      <section class="pmd-party-column"><h3 data-side="client">Parties clientes</h3>${clients.length ? clients.map((node) => nodeCard(node, data.graph)).join('') : '<div class="pmd-column-empty">Aucune partie cliente désignée.</div>'}</section>
      <section class="pmd-party-column"><h3 data-side="adverse">Parties adverses</h3>${adversaries.length ? adversaries.map((node) => nodeCard(node, data.graph)).join('') : '<div class="pmd-column-empty">Aucune partie adverse désignée.</div>'}</section>
    </div>` : `<div class="pmd-no-parties">${shieldCheckIcon}<h3>Aucune partie désignée</h3><p>Ouvrez le mapping pour désigner une entité détectée comme partie, ou ajoutez une partie.</p><button class="pmd-button" data-action="mapping">◇ Ouvrir le mapping</button></div>`}
    ${others.length ? `<section class="pmd-other-entities"><h3>Autres entités du mapping</h3><div class="pmd-entity-list">${others.map((node) => `<button data-edit-node="${escapeHtml(node.id)}"><span>${escapeHtml(node.label)}</span><small>${escapeHtml(labels[node.kind])}</small></button>`).join('')}</div></section>` : ''}
    <div class="pmd-sticky-status">
      <span>${data.graph.links.length} relation(s) · ${data.graph.mappings.length} mapping(s) · ${data.overview.counts.document || 0} document(s)</span>
      <button class="pmd-button pmd-button-primary" data-action="refresh">Enregistrer les profils</button>
    </div>
  `;
}

export function mappingView(data: ViewData): string {
  const entries = data.graph.nodes.filter((node) => node.kind !== 'document');
  return `<div class="pmd-toolbar"><div><h2 class="pmd-title">Mapping</h2><div class="pmd-subtitle">Entités détectées et pseudonymes associés</div></div><span class="pmd-spacer"></span><button class="pmd-icon-button" data-close>×</button></div><div class="pmd-mapping-list">${entries.map((node) => {
    const mappings = data.graph.mappings.filter((mapping) => mapping.nodeId === node.id);
    return `<button data-edit-node="${escapeHtml(node.id)}"><span><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(labels[node.kind])}</small></span><span>${mappings.map((mapping) => escapeHtml(mapping.masked)).join(', ') || 'Non anonymisé'}</span></button>`;
  }).join('') || '<div class="pmd-empty">Aucune entité détectée.</div>'}</div>`;
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
  return `<article class="pmd-chronology-event" data-dated="${dated}"><div class="pmd-chronology-marker" aria-hidden="true"></div><div class="pmd-chronology-date">${escapeHtml(dated ? chronologyDateLabel(dateFor(node)) : 'Date non renseignée')}</div><div class="pmd-chronology-document pmd-card"><div class="pmd-card-head"><div class="pmd-document-heading"><div class="pmd-card-title">${escapeHtml(node.label)}</div><div class="pmd-document-meta">${escapeHtml(nature || 'Type non renseigné')}${localisation ? ` · ${escapeHtml(localisation)}` : ''}</div></div><button class="pmd-icon-button" data-edit-document="${escapeHtml(node.id)}" aria-label="Modifier ${escapeHtml(node.label)}" title="Modifier le document">✎</button></div>${chronologyFields(node)}<div class="pmd-document-related"><span class="pmd-document-related-label">Personnes liées</span><div class="pmd-badges">${related.map((entry) => `<span class="pmd-badge">${escapeHtml(entry.label)}</span>`).join('') || '<span class="pmd-badge pmd-badge-muted">Aucune personne liée</span>'}</div></div></div></article>`;
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

const mermaidId = (value: string): string => `n_${value.replace(/[^a-zA-Z0-9_]/g, '_')}`;
const mermaidLabel = (value: string): string => value.replace(/["\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

function mermaidNode(node: KnowledgeNode): string {
  const label = mermaidLabel(node.label);
  if (node.kind === 'document') return `${mermaidId(node.id)}[/${JSON.stringify(`Document · ${label}`)}/]`;
  if (node.data.partySide === 'client') return `${mermaidId(node.id)}([${JSON.stringify(label)}])`;
  if (node.data.partySide === 'adversaire') return `${mermaidId(node.id)}([${JSON.stringify(label)}])`;
  return `${mermaidId(node.id)}[${JSON.stringify(label)}]`;
}

export function mermaidSource(snapshot: KnowledgeSnapshot): string {
  const clients = snapshot.nodes.filter((node) => node.data.partySide === 'client');
  const adversaries = snapshot.nodes.filter((node) => node.data.partySide === 'adversaire');
  const parties = new Set([...clients, ...adversaries].map((node) => node.id));
  const documents = snapshot.nodes.filter((node) => node.kind === 'document');
  const others = snapshot.nodes.filter((node) => node.kind !== 'document' && !parties.has(node.id));
  const declarations = (nodes: KnowledgeNode[]) => nodes.map((node) => `    ${mermaidNode(node)}`).join('\n');
  const lines = ['flowchart TB'];
  if (documents.length) lines.push('  subgraph docs[Documents]', '    direction LR', declarations(documents), '  end');
  lines.push('  subgraph center[Parties]', '    direction TB');
  if (clients.length) lines.push('    subgraph clients[Parties clientes]', '      direction LR', declarations(clients), '    end');
  if (adversaries.length) lines.push('    subgraph adversaires[Parties adverses]', '      direction LR', declarations(adversaries), '    end');
  if (!clients.length && !adversaries.length) lines.push('    no_party["Aucune partie sélectionnée"]');
  lines.push('  end');
  if (others.length) lines.push('  subgraph related[Entités liées]', '    direction LR', declarations(others), '  end');
  for (const link of snapshot.links) lines.push(`  ${mermaidId(link.fromNodeId)} -->|${JSON.stringify(mermaidLabel(link.relation))}| ${mermaidId(link.toNodeId)}`);
  const firstParty = clients[0] || adversaries[0];
  if (documents[0] && firstParty) lines.push(`  ${mermaidId(documents[0].id)} ~~~ ${mermaidId(firstParty.id)}`);
  if (firstParty && others[0]) lines.push(`  ${mermaidId(firstParty.id)} ~~~ ${mermaidId(others[0].id)}`);
  lines.push('  classDef document fill:#eff6ff,stroke:#60a5fa,color:#1e3a8a,stroke-width:1.5px');
  lines.push('  classDef client fill:#dcfce7,stroke:#22c55e,color:#14532d,stroke-width:3px');
  lines.push('  classDef adverse fill:#fee2e2,stroke:#ef4444,color:#7f1d1d,stroke-width:3px');
  lines.push('  classDef person fill:#f5f3ff,stroke:#a78bfa,color:#4c1d95,stroke-width:1.5px');
  lines.push('  classDef company fill:#fffbeb,stroke:#f59e0b,color:#78350f,stroke-width:1.5px');
  lines.push('  classDef financial fill:#ecfeff,stroke:#06b6d4,color:#164e63,stroke-width:1.5px');
  lines.push('  classDef detail fill:#f4f4f5,stroke:#a1a1aa,color:#27272a,stroke-width:1px');
  if (documents.length) lines.push(`  class ${documents.map((node) => mermaidId(node.id)).join(',')} document`);
  if (clients.length) lines.push(`  class ${clients.map((node) => mermaidId(node.id)).join(',')} client`);
  if (adversaries.length) lines.push(`  class ${adversaries.map((node) => mermaidId(node.id)).join(',')} adverse`);
  const remaining = others.filter((node) => node.kind === 'person');
  const remainingCompanies = others.filter((node) => node.kind === 'company');
  const financial = others.filter((node) => node.kind === 'iban' || node.kind === 'siren');
  const details = others.filter((node) => !remaining.includes(node) && !remainingCompanies.includes(node) && !financial.includes(node));
  if (remaining.length) lines.push(`  class ${remaining.map((node) => mermaidId(node.id)).join(',')} person`);
  if (remainingCompanies.length) lines.push(`  class ${remainingCompanies.map((node) => mermaidId(node.id)).join(',')} company`);
  if (financial.length) lines.push(`  class ${financial.map((node) => mermaidId(node.id)).join(',')} financial`);
  if (details.length) lines.push(`  class ${details.map((node) => mermaidId(node.id)).join(',')} detail`);
  lines.push('  style center fill:transparent,stroke:#a1a1aa,stroke-width:2px');
  lines.push('  style clients fill:#10b98112,stroke:#10b981,stroke-width:1.5px');
  lines.push('  style adversaires fill:#ef444412,stroke:#ef4444,stroke-width:1.5px');
  lines.push('  linkStyle default stroke:#a1a1aa,stroke-width:1.25px');
  return lines.filter(Boolean).join('\n');
}

export function graphView(): string {
  return `<div class="pmd-toolbar"><div><h2 class="pmd-title">Graphe du dossier</h2><div class="pmd-subtitle">Documents, parties et entités liées, avec toutes les relations résolues</div></div><span class="pmd-spacer"></span><button class="pmd-button" data-action="refresh">Rafraîchir</button></div><div class="pmd-graph-legend"><span data-kind="document">Documents</span><span data-kind="client">Parties clientes</span><span data-kind="adverse">Parties adverses</span><span data-kind="person">Personnes</span><span data-kind="company">Sociétés</span><span data-kind="financial">Identifiants</span></div><div class="pmd-graph-card"><div class="pmd-mermaid" data-mermaid></div></div>`;
}
