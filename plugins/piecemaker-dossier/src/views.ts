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
  return `
    <article class="pmd-card">
      <div class="pmd-card-head">
        <div><div class="pmd-card-kind">${escapeHtml(labels[node.kind])}</div><div class="pmd-card-title">${escapeHtml(node.label || 'Sans libellé')}</div></div>
        <div class="pmd-card-actions">
          <button class="pmd-icon-button" data-edit-node="${escapeHtml(node.id)}" aria-label="Modifier">✎</button>
          <button class="pmd-icon-button pmd-button-danger" data-delete-node="${escapeHtml(node.id)}" aria-label="Supprimer">×</button>
        </div>
      </div>
      <div class="pmd-meta">${mappings.map((mapping) => `${escapeHtml(mapping.real)} → ${escapeHtml(mapping.masked)}`).join('<br>') || 'Aucun mapping'}</div>
      <div class="pmd-badges">
        ${side ? `<span class="pmd-badge">${side === 'client' ? 'Partie cliente' : 'Partie adverse'}</span>` : ''}
        ${node.kind === 'company' && textValue(node.data.legalForm) ? `<span class="pmd-badge">${escapeHtml(node.data.legalForm)}</span>` : ''}
        <span class="pmd-badge">${relationCount(node.id, graph.links)} lien(s)</span>
      </div>
    </article>`;
}

export function shell(active: Tab): string {
  return `
    <div class="pmd-header">
      <div class="pmd-tabs" role="tablist">
        <button class="pmd-tab" data-tab="general" aria-selected="${active === 'general'}">Général</button>
        <button class="pmd-tab" data-tab="chronology" aria-selected="${active === 'chronology'}">Chronologie</button>
        <button class="pmd-tab" data-tab="graph" aria-selected="${active === 'graph'}">Graphe</button>
      </div>
      <button class="pmd-button" data-action="agents">▤ Agents.md</button>
    </div>
    <div data-error></div>
    <main class="pmd-content" data-content></main>`;
}

export function generalView(data: ViewData): string {
  const groups = entityKinds
    .map((kind) => [kind, data.graph.nodes.filter((node) => node.kind === kind)] as [NodeKind, KnowledgeNode[]])
    .filter(([, entries]) => entries.length);
  return `
    <div class="pmd-toolbar">
      <div><h2 class="pmd-title">Général</h2><div class="pmd-subtitle">Entités, mappings et relations du projet</div></div>
      <span class="pmd-spacer"></span><button class="pmd-button" data-action="refresh">Rafraîchir</button><button class="pmd-button" data-action="scan">Analyser</button><button class="pmd-button pmd-button-primary" data-action="add-node">Ajouter</button>
    </div>
    <div class="pmd-summary">
      <div class="pmd-metric"><strong>${data.overview.total}</strong><span>éléments indexés</span></div>
      <div class="pmd-metric"><strong>${data.graph.links.length}</strong><span>relations</span></div>
      <div class="pmd-metric"><strong>${data.graph.mappings.length}</strong><span>mappings</span></div>
      <div class="pmd-metric"><strong>${data.overview.counts.document || 0}</strong><span>documents</span></div>
    </div>
    ${groups.length ? groups.map(([kind, nodes]) => `<h3 class="pmd-group">${escapeHtml(labels[kind])} · ${nodes.length}</h3><div class="pmd-grid">${nodes.map((node) => nodeCard(node, data.graph)).join('')}</div>`).join('') : '<div class="pmd-empty">Aucune entité. Lancez une analyse ou ajoutez un élément.</div>'}`;
}

export function chronologyView(data: ViewData): string {
  const nodes = [...data.chronology.documents].sort((left, right) => dateFor(left).localeCompare(dateFor(right)) || left.label.localeCompare(right.label, 'fr'));
  const byId = new Map(data.graph.nodes.map((node) => [node.id, node]));
  return `
    <div class="pmd-toolbar"><div><h2 class="pmd-title">Chronologie</h2><div class="pmd-subtitle">Documents et personnes liées</div></div><span class="pmd-spacer"></span><button class="pmd-button" data-action="refresh">Rafraîchir</button></div>
    ${nodes.length ? `<div class="pmd-timeline">${nodes.map((node) => {
      const links = data.graph.links.filter((link) => link.relation === 'mentions' && (link.fromNodeId === node.id || link.toNodeId === node.id));
      const related = links.map((link) => byId.get(link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId)).filter(Boolean) as KnowledgeNode[];
      return `<article class="pmd-card pmd-event"><div class="pmd-card-head"><div><div class="pmd-card-kind">${escapeHtml(dateFor(node) || 'Date inconnue')}</div><div class="pmd-card-title">${escapeHtml(node.label)}</div></div><div class="pmd-card-actions"><button class="pmd-icon-button" data-edit-document="${escapeHtml(node.id)}">✎</button></div></div><div class="pmd-meta">${escapeHtml(textValue(node.data.nature) || 'Type non renseigné')}${textValue(node.data.localisation) ? ` · ${escapeHtml(node.data.localisation)}` : ''}</div><div class="pmd-badges">${related.map((entry) => `<span class="pmd-badge">${escapeHtml(entry.label)}</span>`).join('') || '<span class="pmd-badge">Aucune personne liée</span>'}</div></article>`;
    }).join('')}</div>` : '<div class="pmd-empty">Aucun document indexé.</div>'}`;
}

const mermaidId = (value: string): string => `n_${value.replace(/[^a-zA-Z0-9_]/g, '_')}`;
const mermaidLabel = (value: string): string => value.replace(/["\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export function mermaidSource(snapshot: KnowledgeSnapshot): string {
  const clients = snapshot.nodes.filter((node) => node.data.partySide === 'client');
  const adversaries = snapshot.nodes.filter((node) => node.data.partySide === 'adversaire');
  const parties = new Set([...clients, ...adversaries].map((node) => node.id));
  const documents = snapshot.nodes.filter((node) => node.kind === 'document');
  const others = snapshot.nodes.filter((node) => node.kind !== 'document' && !parties.has(node.id));
  const declarations = (nodes: KnowledgeNode[]) => nodes.map((node) => `    ${mermaidId(node.id)}["${mermaidLabel(node.label)}"]`).join('\n');
  const lines = ['flowchart LR'];
  if (documents.length) lines.push('  subgraph docs[Documents]', declarations(documents), '  end');
  lines.push('  subgraph center[Parties]', '    direction TB');
  if (clients.length) lines.push('    subgraph clients[Parties clientes]', declarations(clients), '    end');
  if (adversaries.length) lines.push('    subgraph adversaires[Parties adverses]', declarations(adversaries), '    end');
  if (!clients.length && !adversaries.length) lines.push('    no_party["Aucune partie sélectionnée"]');
  lines.push('  end');
  if (others.length) lines.push('  subgraph related[Entités liées]', declarations(others), '  end');
  for (const link of snapshot.links) lines.push(`  ${mermaidId(link.fromNodeId)} -->|"${mermaidLabel(link.relation)}"| ${mermaidId(link.toNodeId)}`);
  const firstParty = clients[0] || adversaries[0];
  if (documents[0] && firstParty) lines.push(`  ${mermaidId(documents[0].id)} ~~~ ${mermaidId(firstParty.id)}`);
  if (firstParty && others[0]) lines.push(`  ${mermaidId(firstParty.id)} ~~~ ${mermaidId(others[0].id)}`);
  lines.push('  classDef client fill:#166534,stroke:#4ade80,color:#fff,stroke-width:2px');
  lines.push('  classDef adverse fill:#991b1b,stroke:#fb7185,color:#fff,stroke-width:2px');
  if (clients.length) lines.push(`  class ${clients.map((node) => mermaidId(node.id)).join(',')} client`);
  if (adversaries.length) lines.push(`  class ${adversaries.map((node) => mermaidId(node.id)).join(',')} adverse`);
  return lines.filter(Boolean).join('\n');
}

export function graphView(): string {
  return `<div class="pmd-toolbar"><div><h2 class="pmd-title">Graphe</h2><div class="pmd-subtitle">Parties clientes et adverses au centre, relations résolues autour</div></div><span class="pmd-spacer"></span><button class="pmd-button" data-action="refresh">Rafraîchir</button></div><div class="pmd-card" style="overflow:auto"><div class="pmd-mermaid" data-mermaid></div></div>`;
}
