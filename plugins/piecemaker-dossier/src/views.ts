import { NODE_KINDS } from './types.js';
import type { KnowledgeLink, KnowledgeNode, KnowledgeSnapshot, NodeKind } from './types.js';
import { BODACC_FAMILIES } from './api.js';
import type { BodaccSearchResult, CompanySearchResult, KnowledgeChronologyView, KnowledgeMappingView, KnowledgeOverview, ScanJob } from './api.js';

export type Tab = 'general' | 'chronology' | 'scan';
export type BodaccScanState = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  result?: BodaccSearchResult;
  error?: string;
  open?: boolean;
  families?: string[];
  companySearchStatus?: 'idle' | 'loading' | 'loaded' | 'error';
  companySearchResults?: CompanySearchResult[];
  companySearchError?: string;
};
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

const userIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 21a8 8 0 0 0-16 0"></path><circle cx="10" cy="7" r="4"></circle><path d="M22 21a8 8 0 0 0-5-7.7"></path></svg>';
const companyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4c0-.5.4-1 1-1h10c.6 0 1 .5 1 1v18"></path><path d="M6 12H4c-.6 0-1 .4-1 1v9"></path><path d="M18 9h2c.6 0 1 .4 1 1v12"></path><path d="M10 6h4M10 10h4M10 14h4M10 18h4"></path></svg>';
const tagIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.8A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .8 1.4l8.5 8.5a2.4 2.4 0 0 0 3.4 0l6.4-6.4a2.4 2.4 0 0 0 0-3.4z"></path><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"></circle></svg>';
const gearIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.2a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.2a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.2a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.2a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const moreIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';
const pencilIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>';
const trashIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"></path><path d="M10 11v6M14 11v6"></path></svg>';

function profileKind(node: KnowledgeNode): { label: string; icon: string; kind: string } {
  if (node.kind === 'person') return { label: 'Personne physique', icon: userIcon, kind: 'person' };
  if (node.kind === 'company') return { label: 'Personne morale', icon: companyIcon, kind: 'company' };
  return { label: labels[node.kind].replace(/s$/, ''), icon: tagIcon, kind: 'other' };
}

function positionLabel(node: KnowledgeNode): string {
  const position = textValue(node.data.position);
  const labelsByPosition: Record<string, string> = { demandeur: 'Demandeur', defendeur: 'Défendeur', appelant: 'Appelant', intime: 'Intimé', requerant: 'Requérant', mis_en_cause: 'Mis en cause', intervenant: 'Intervenant' };
  return labelsByPosition[position] || position || (node.data.partySide === 'client' ? 'Demandeur' : node.data.partySide === 'adversaire' ? 'Défendeur' : 'Aucune position procédurale');
}

function nodeCard(node: KnowledgeNode, graph: KnowledgeSnapshot): string {
  const side = textValue(node.data.partySide);
  const showRelations = side === 'client' || side === 'adversaire';
  const nodesById = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  const relations = showRelations ? graph.links.filter((link) => {
    if (link.fromNodeId !== node.id && link.toNodeId !== node.id) return false;
    const other = nodesById.get(link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId);
    return link.relation !== 'mentions' && (other?.kind === 'person' || other?.kind === 'company');
  }) : [];
  const kind = profileKind(node);
  const accent = side === 'client' ? 'client' : side === 'adversaire' ? 'adverse' : 'neutral';
  return `
    <article class="pmd-profile-card" data-side="${accent}" draggable="true" data-profile-id="${escapeHtml(node.id)}">
      <div class="pmd-profile-accent"></div>
      <div class="pmd-card-head">
        <span class="pmd-kind-icon" data-kind="${kind.kind}">${kind.icon}</span>
        <div class="pmd-profile-heading"><div class="pmd-card-title">${escapeHtml(node.label || 'Sans libellé')}</div><div class="pmd-profile-kind">${escapeHtml(kind.label)}</div></div>
        <div class="pmd-profile-menu-wrap">
          <button class="pmd-profile-menu-trigger" data-node-menu aria-label="Options pour ${escapeHtml(node.label)}">${moreIcon}</button>
          <div class="pmd-profile-menu"><button data-edit-node="${escapeHtml(node.id)}">${userIcon}<span>Modifier</span></button><button class="pmd-menu-danger" data-delete-node="${escapeHtml(node.id)}">×<span>Supprimer</span></button></div>
        </div>
      </div>
      ${side === 'client' || side === 'adversaire' ? `<div class="pmd-party-line"><span class="pmd-party-badge" data-side="${accent}">${side === 'client' ? 'Partie cliente' : 'Partie adverse'} · ${escapeHtml(positionLabel(node))}<button type="button" class="pmd-party-badge-remove" data-remove-party="${escapeHtml(node.id)}" aria-label="Retirer la désignation de partie" title="Retirer la désignation de partie">×</button></span></div>` : ''}
      ${showRelations ? `<div class="pmd-relations-box" data-relation-drop="${escapeHtml(node.id)}">
        ${relations.length ? relations.map((link) => {
          const otherId = link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId;
          const other = nodesById.get(otherId);
          return `<div class="pmd-related"><div><span>Profil lié</span><strong>${escapeHtml(other?.label || otherId)}</strong><small>${escapeHtml(link.relation)}</small></div><button data-unlink-from="${escapeHtml(link.fromNodeId)}" data-unlink-to="${escapeHtml(link.toNodeId)}" data-unlink-relation="${escapeHtml(link.relation)}" aria-label="Supprimer le lien">×</button></div>`;
        }).join('<div class="pmd-related-separator"></div>') : '<div class="pmd-relation-empty">Glissez un profil ici<br>pour établir un lien</div>'}
        ${relations.length ? '<div class="pmd-drop-hint">Glissez un autre profil ici pour ajouter un lien</div>' : ''}
      </div>` : ''}
    </article>`;
}

const shieldCheckIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg>';
const scanSearchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><circle cx="12" cy="12" r="3"></circle><path d="m16 16-1.9-1.9"></path></svg>';
const tiersProfileIcon = '<svg class="pmd-tiers-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 21a8 8 0 0 0-16 0"></path><circle cx="10" cy="7" r="4"></circle><path d="M22 21a8 8 0 0 0-5-7.7"></path></svg>';

const folderTreeIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"></path><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"></path><path d="M3 5a2 2 0 0 0 2 2h3"></path><path d="M3 3v13a2 2 0 0 0 2 2h3"></path></svg>';
const calendarClockIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h5"></path><circle cx="16" cy="16" r="6"></circle><path d="M16 14v2l1 1"></path></svg>';
const bodaccIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z"></path><path d="M8 8h8M8 12h8M8 16h5"></path></svg>';
const bodaccSearchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h10v16H4z"></path><path d="M7 8h4M7 12h4"></path><circle cx="16.5" cy="16.5" r="3.5"></circle><path d="m19.2 19.2 2 2"></path></svg>';
const companySearchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'general', label: 'Parties', icon: folderTreeIcon },
  { id: 'chronology', label: 'Chronologie', icon: calendarClockIcon },
  { id: 'scan', label: 'Scan Bodacc', icon: bodaccIcon },
];

export function scanPercentLabel(job: ScanJob): string {
  return `${Math.round(Math.max(0, Math.min(100, job.percent || 0)))} %`;
}

export function scanProgress(job: ScanJob): string {
  const percent = Math.max(0, Math.min(100, job.percent || 0));
  return `
    <span class="pmd-scan-progress" data-scan-progress>
      <span class="pmd-scan-progress-label">${escapeHtml(scanPercentLabel(job))}</span>
      <span class="pmd-scan-progress-track" role="progressbar" aria-label="Anonymisation du dossier" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}">
        <span class="pmd-scan-progress-bar" style="width:${percent}%"></span>
      </span>
      <button type="button" class="pmd-scan-cancel" data-action="cancel-scan" aria-label="Arrêter l’analyse" title="Arrêter l’analyse">×</button>
    </span>`;
}

export function shell(active: Tab, mappingCount = 0, job: ScanJob | null = null): string {
  const scanning = Boolean(job && job.state === 'running');
  return `
    <div class="pmd-header">
      <div class="pmd-tabs" role="tablist">
        ${TABS.map(({ id, label, icon }) => `<button type="button" class="pmd-tab" role="tab" data-tab="${id}" aria-selected="${active === id}" tabindex="${active === id ? 0 : -1}">${icon}<span>${label}</span></button>`).join('')}
        <button class="pmd-button pmd-agents-button" data-action="agents"><span>▤</span> Agents.md</button>
      </div>
      <div class="pmd-scan-status" data-ready="${mappingCount > 0}" data-scanning="${scanning}">
        <span class="pmd-status-icon">${shieldCheckIcon}</span>
        ${scanning && job ? scanProgress(job) : `<span class="pmd-status-label">${mappingCount} anonymisé(s)</span>`}
        <button class="pmd-scan-button" data-action="scan" ${scanning ? 'disabled' : ''}>${scanSearchIcon}<span>${scanning ? 'Analyse en cours…' : mappingCount > 0 ? 'Relancer' : 'Lancer'}</span></button>
      </div>
    </div>
    <div data-error></div>
    <div class="pmd-workspace"><main class="pmd-content" data-content></main></div>`;
}

export function generalView(data: ViewData, tiersCollapsed = false): string {
  const entities = data.graph.nodes.filter((node) => node.kind !== 'document');
  const clients = entities.filter((node) => node.data.partySide === 'client');
  const adversaries = entities.filter((node) => node.data.partySide === 'adversaire');
  const tiers = entities.filter((node) => (node.kind === 'person' || node.kind === 'company') && node.data.partySide !== 'client' && node.data.partySide !== 'adversaire');
  return `
    <div class="pmd-general">
    <div class="pmd-general-actions">
      <button class="pmd-button pmd-small-button" data-action="mapping">${tagIcon} Mapping</button>
      <button class="pmd-button pmd-small-button" data-action="add-node">＋ Ajouter une partie</button>
    </div>
    ${clients.length || adversaries.length || tiers.length ? `<div class="pmd-party-layout" data-tiers-collapsed="${tiersCollapsed}"><div class="pmd-party-columns">
      <section class="pmd-party-column"><h3 data-side="client">Parties clientes</h3>${clients.map((node) => nodeCard(node, data.graph)).join('')}<button type="button" class="pmd-column-empty" data-party-picker="client" data-party-drop="client"><span>${clients.length ? 'Ajouter une autre partie cliente' : 'Aucune partie cliente désignée.'}</span><small>Cliquer ou déposer un profil</small></button></section>
      <section class="pmd-party-column"><h3 data-side="adverse">Parties adverses</h3>${adversaries.map((node) => nodeCard(node, data.graph)).join('')}<button type="button" class="pmd-column-empty" data-party-picker="adversaire" data-party-drop="adversaire"><span>${adversaries.length ? 'Ajouter une autre partie adverse' : 'Aucune partie adverse désignée.'}</span><small>Cliquer ou déposer un profil</small></button></section>
    </div>${tiers.length ? `<aside class="pmd-tiers-column" data-tiers-column data-collapsed="${tiersCollapsed}"><button type="button" class="pmd-tiers-toggle" data-action="toggle-tiers" aria-expanded="${!tiersCollapsed}" aria-controls="pmd-tiers-content">${tiersProfileIcon}<span class="pmd-tiers-label">Tiers</span><span class="pmd-tiers-count">${tiers.length}</span></button><div id="pmd-tiers-content" class="pmd-tiers-content" role="region" aria-label="Tiers">${tiers.map((node) => nodeCard(node, data.graph)).join('')}</div></aside>` : ''}</div>` : `<div class="pmd-no-parties">${shieldCheckIcon}<h3>Aucune partie désignée</h3><p>Ouvrez le mapping pour désigner une entité détectée comme partie, ou ajoutez une partie.</p><button class="pmd-button" data-action="mapping">◇ Ouvrir le mapping</button></div>`}
    <div class="pmd-sticky-status">
      <span>Glissez un profil sur un autre pour créer un lien.</span>
      <button class="pmd-button pmd-button-primary pmd-small-button" data-action="refresh">✓ Enregistrer les profils</button>
    </div>
    </div>
  `;
}

function companyIdentifiers(node: KnowledgeNode, graph: KnowledgeSnapshot): { siren: string; siret: string } {
  const identifiers = { siren: '', siret: '' };
  for (const link of graph.links.filter((entry) => entry.fromNodeId === node.id || entry.toNodeId === node.id)) {
    const relation = link.relation.toLocaleLowerCase();
    const related = graph.nodes.find((entry) => entry.id === (link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId));
    const value = related?.label || '';
    const digits = value.replace(/\D/g, '');
    if (relation === 'siren' && digits.length === 9) identifiers.siren = digits;
    if (relation === 'siret' && digits.length === 14) identifiers.siret = digits;
  }
  const dataSiren = textValue(node.data.siren).replace(/\D/g, '');
  const dataSiret = textValue(node.data.siret).replace(/\D/g, '');
  if (!identifiers.siren && dataSiren.length === 9) identifiers.siren = dataSiren;
  if (!identifiers.siret && dataSiret.length === 14) identifiers.siret = dataSiret;
  if (!identifiers.siren && identifiers.siret) identifiers.siren = identifiers.siret.slice(0, 9);
  return identifiers;
}

function bodaccAnnouncement(announcement: BodaccSearchResult['annonces'][number]): string {
  const details = [
    ['Date', announcement.datePublication],
    ['Avis', announcement.typeAvis],
    ['Famille', announcement.familleAvis],
    ['Entreprise', announcement.commercant],
    ['Ville', announcement.ville],
    ['Tribunal', announcement.tribunal],
    ['Jugement', announcement.jugement],
    ['Acte', announcement.acte],
  ].filter((entry) => entry[1]);
  return `<article class="pmd-bodacc-announcement"><div class="pmd-bodacc-announcement-head"><strong>${escapeHtml(announcement.typeAvis || announcement.familleAvis || 'Annonce BODACC')}</strong>${announcement.datePublication ? `<time>${escapeHtml(announcement.datePublication)}</time>` : ''}</div><dl>${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>${announcement.url ? `<a href="${escapeHtml(announcement.url)}" target="_blank" rel="noopener noreferrer">Ouvrir l’annonce officielle ↗</a>` : ''}</article>`;
}

function bodaccStateMarkup(state: BodaccScanState, siren: string): string {
  if (state.status === 'loading') return '<p class="pmd-bodacc-status">Recherche des annonces BODACC…</p>';
  if (state.status === 'error') return `<p class="pmd-bodacc-status pmd-bodacc-error">${escapeHtml(state.error || 'Recherche impossible.')}</p>`;
  if (state.status === 'idle') return `<p class="pmd-bodacc-status">Rechercher les annonces liées au SIREN ${escapeHtml(siren)}.</p>`;
  const result = state.result;
  if (!result || !result.annonces.length) return `<p class="pmd-bodacc-status">Aucune annonce BODACC trouvée pour le SIREN ${escapeHtml(siren)}.</p>`;
  return `${result.alertes.length ? `<div class="pmd-bodacc-alerts">${result.alertes.map((alerte) => `<span>${escapeHtml(alerte)}</span>`).join('')}</div>` : ''}<p class="pmd-bodacc-summary">${result.annonces.length} annonce${result.annonces.length > 1 ? 's' : ''} affichée${result.annonces.length > 1 ? 's' : ''} sur ${result.total}.</p><div class="pmd-bodacc-list">${result.annonces.map(bodaccAnnouncement).join('')}</div>`;
}

function companySearchResultMarkup(result: CompanySearchResult, companyId: string, index: number): string {
  return `<article class="pmd-company-result"><h4>${escapeHtml(result.name)}</h4><p>${escapeHtml(result.summary)}</p><dl><div><dt>SIREN</dt><dd>${escapeHtml(result.fields.siren || result.siren)}</dd></div>${result.fields.directors.length ? `<div><dt>Dirigeants</dt><dd>${escapeHtml(result.fields.directors.map((director) => director.name).join(', '))}</dd></div>` : ''}</dl>${result.url ? `<a class="pmd-company-result-link" href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">Vérifier la fiche officielle ↗</a>` : ''}<details><summary>Voir toutes les informations</summary><pre>${escapeHtml(result.details)}</pre></details><button type="button" class="pmd-button pmd-button-primary pmd-company-validate" data-action="company-validate" data-scan-company="${escapeHtml(companyId)}" data-company-result="${index}">Valider cette personne morale</button></article>`;
}

function companySearchStateMarkup(state: BodaccScanState, companyId: string): string {
  if (state.companySearchStatus === 'loading') return '<p class="pmd-bodacc-status">Recherche dans le Registre Public…</p>';
  if (state.companySearchStatus === 'error') return `<p class="pmd-bodacc-status pmd-bodacc-error">${escapeHtml(state.companySearchError || 'Recherche Registre Public impossible.')}</p>`;
  if (!state.companySearchResults?.length) return '<p class="pmd-bodacc-status">Aucun résultat Registre Public.</p>';
  return `<p class="pmd-bodacc-summary">${state.companySearchResults.length} résultat${state.companySearchResults.length > 1 ? 's' : ''} Registre Public.</p><div class="pmd-company-search-results">${state.companySearchResults.map((result, index) => companySearchResultMarkup(result, companyId, index)).join('')}</div>`;
}

function bodaccFamilyMenu(companyId: string, families: string[]): string {
  return `<div class="pmd-profile-menu-wrap pmd-bodacc-family-wrap"><button type="button" class="pmd-profile-menu-trigger pmd-bodacc-family-trigger" data-action="company-family-menu" data-scan-company="${escapeHtml(companyId)}" aria-label="Choisir les familles BODACC" aria-expanded="false" title="Choisir les familles BODACC">${moreIcon}</button><div class="pmd-profile-menu pmd-bodacc-family-menu" data-bodacc-family-menu="${escapeHtml(companyId)}"><strong>Familles BODACC</strong>${BODACC_FAMILIES.map((family) => `<label><input type="checkbox" data-bodacc-family="${escapeHtml(family.code)}" data-scan-company="${escapeHtml(companyId)}" ${families.includes(family.code) ? 'checked' : ''}><span>${escapeHtml(family.label)}</span></label>`).join('')}</div></div>`;
}

export function scanView(data: ViewData, states: Map<string, BodaccScanState> = new Map()): string {
  const companies = data.graph.nodes.filter((node) => node.kind === 'company').sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));
  if (!companies.length) return '<div class="pmd-empty">Aucune personne morale dans le dossier.</div>';
  return `<div class="pmd-scan-view"><div class="pmd-toolbar"><div><h2 class="pmd-title">Scan Bodacc</h2><div class="pmd-subtitle">Annonces liées aux personnes morales du dossier</div></div><span class="pmd-spacer"></span><button type="button" class="pmd-button pmd-scan-all-button" data-action="scan-all-companies" aria-label="Scanner toutes les personnes morales">${bodaccSearchIcon}<span>Scanner toutes les personnes</span></button></div><div class="pmd-scan-company-list">${companies.map((company) => {
    const identifiers = companyIdentifiers(company, data.graph);
    const state = states.get(company.id) || { status: 'idle' as const };
    const identifierLabel = [identifiers.siren ? `SIREN ${identifiers.siren}` : '', identifiers.siret ? `SIRET ${identifiers.siret}` : ''].filter(Boolean).join(' · ') || 'SIREN / SIRET non renseigné';
    const families = state.families || BODACC_FAMILIES.map((family) => family.code);
    return `<article class="pmd-scan-company" data-scan-company="${escapeHtml(company.id)}" data-siren="${escapeHtml(identifiers.siren)}" data-siret="${escapeHtml(identifiers.siret)}"><div class="pmd-scan-company-header"><div class="pmd-scan-company-copy"><h3>${escapeHtml(company.label || 'Personne morale sans nom')}</h3><p>${escapeHtml(identifierLabel)}</p></div><div class="pmd-scan-company-actions"><button type="button" class="pmd-icon-button" data-action="company-search" data-scan-company="${escapeHtml(company.id)}" data-siren="${escapeHtml(identifiers.siren)}" data-siret="${escapeHtml(identifiers.siret)}" aria-label="Rechercher cette personne morale" title="Rechercher dans Registre Public">${companySearchIcon}</button>${bodaccFamilyMenu(company.id, families)}</div></div><details class="pmd-bodacc-accordion" data-bodacc-details="${escapeHtml(company.id)}" ${state.open ? 'open' : ''}><summary>Annonces BODACC${state.status === 'loaded' && state.result ? ` · ${state.result.annonces.length}` : ''}</summary><div class="pmd-bodacc-content">${bodaccStateMarkup(state, identifiers.siren || identifiers.siret)}</div></details></article>`;
  }).join('')}</div></div>`;
}

export function mappingView(data: ViewData): string {
  const entries = data.graph.nodes.filter((node) => node.kind !== 'document');
  const categories = entityKinds.map((kind) => ({ kind, label: labels[kind], entries: entries.filter((node) => node.kind === kind) })).filter((category) => category.entries.length);
  return `<div class="pmd-mapping-dialog"><div class="pmd-mapping-header"><h2>Mapping de pseudonymisation</h2><button class="pmd-icon-button" data-action="institutional-terms" aria-label="Termes institutionnels" title="Termes institutionnels jamais pseudonymisés">${gearIcon}</button><button class="pmd-icon-button" data-close>×</button></div><div class="pmd-mapping-body"><p>Chaque ligne associe une clé de pseudonymisation au variant principal rétabli lors du revert et aux autres écritures détectées.</p>${categories.map((category) => `<section class="pmd-mapping-category"><header><h3>${escapeHtml(category.label)} <span>${category.entries.length}</span></h3><button data-action="add-node">＋ Ajouter</button></header><div>${category.entries.map((node) => {
    const mappings = data.graph.mappings.filter((mapping) => mapping.nodeId === node.id);
    return `<form class="pmd-mapping-row" data-mapping-row data-node-id="${escapeHtml(node.id)}"><input class="pmd-mapping-input" name="masked" aria-label="Code anonymisé" value="${escapeHtml(mappings[0]?.masked || textValue(node.data.code) || node.id)}"><input class="pmd-mapping-input" name="label" aria-label="Libellé" value="${escapeHtml(node.label)}" required><input class="pmd-mapping-input" name="aliases" aria-label="Variantes" value="${escapeHtml(node.aliases.join(', '))}" placeholder="Variantes"><div class="pmd-mapping-actions"><div class="pmd-profile-menu-wrap"><button type="button" class="pmd-profile-menu-trigger pmd-mapping-menu-trigger" data-row-menu aria-label="Options pour ${escapeHtml(node.label)}">${moreIcon}</button><div class="pmd-profile-menu"><button type="button" data-edit-node="${escapeHtml(node.id)}">${pencilIcon}<span>Modifier</span></button><button type="button" class="pmd-menu-danger" data-delete-node="${escapeHtml(node.id)}">${trashIcon}<span>Supprimer</span></button></div></div></div></form>`;
  }).join('')}</div></section>`).join('') || '<div class="pmd-empty">Aucune entité détectée.</div>'}</div><div class="pmd-mapping-footer"><button class="pmd-button" data-close>Fermer</button><button class="pmd-button pmd-button-primary" data-close>✓ Enregistrer le mapping</button></div></div>`;
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
  const documents = data.chronology.documents
    .map((document) => {
      const documentPath = textValue(document.data.path);
      return data.graph.nodes.find((candidate) => candidate.kind === 'document'
        && candidate.label === document.label
        && (!documentPath || textValue(candidate.data.path) === documentPath));
    })
    .filter((node): node is KnowledgeNode => Boolean(node));
  const dated = documents
    .filter((node) => Boolean(dateFor(node)))
    .sort((left, right) => dateFor(left).localeCompare(dateFor(right)) || left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));
  const undated = documents
    .filter((node) => !dateFor(node))
    .sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));
  const byId = new Map(data.graph.nodes.map((node) => [node.id, node]));
  return `
    <div class="pmd-toolbar"><div><h2 class="pmd-title">Chronologie</h2><div class="pmd-subtitle">Documents et personnes liées</div></div><span class="pmd-spacer"></span><button class="pmd-button" data-action="refresh">Rafraîchir</button></div>
    ${renderChronologySections(dated, undated, byId, data.graph.links)}`;
}
