import { aliasEditorMarkup, citationListMarkup, companySearchResultMarkup, entityKinds, escapeHtml, kindLabels, natureOptionsMarkup, nodeVariants, parseAliases, proposedPieceName, textValue, dateFor } from './views.js';
import { knowledgeApi } from './api.js';
import type { CompanySearchResult } from './api.js';
import { buildCompanyValidationOperations } from './company-search.js';
import { citableEntities, citationSource, citationsOfEntity, citationsOfMention, pieceMentionOperations } from './citations.js';
import type { PendingCitation } from './citations.js';
import { deleteEntityOperations, removedAliasOperations } from './exclusions.js';
import type { DeleteScope } from './exclusions.js';
import type { ViewData } from './views.js';
import type { KnowledgeNode, KnowledgeUpdateOperation, NodeKind } from './types.js';
import { PROCEDURE_POSITIONS, codeRegistry, isPartyCode, nodeCode, nodePosition, partyCodeChange } from './party-codes.js';
import type { PartySide } from './party-codes.js';
import { changeNodeSide, cleanSelection, createEntity, findEntityBySelection, parseSelectionDate } from './selection-categories.js';
import type { SelectionChange, SelectionGraph } from './selection-categories.js';

export function modal(root: HTMLElement, body: string): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pmd-modal';
  layer.innerHTML = `<div class="pmd-dialog">${body}</div>`;
  root.appendChild(layer);
  layer.addEventListener('click', (event) => { if (event.target === layer) layer.remove(); });
  layer.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => layer.remove()));
  return layer;
}

function overlay(root: HTMLElement, body: string): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pmd-modal';
  layer.innerHTML = `<div class="pmd-dialog pmd-dialog-compact">${body}</div>`;
  root.appendChild(layer);
  return layer;
}

function closeOverlay(layer: HTMLElement, onKey: (event: KeyboardEvent) => void): void {
  document.removeEventListener('keydown', onKey);
  layer.remove();
}

export function askConfirm(root: HTMLElement, title: string, confirmLabel = 'Confirmer'): Promise<boolean> {
  return new Promise((resolve) => {
    const layer = overlay(root, `
      <div class="pmd-confirm">
        <h2 class="pmd-title piecemaker-display">${escapeHtml(title)}</h2>
        <div class="pmd-form-actions">
          <button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Annuler</button>
          <button type="button" class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`);
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      closeOverlay(layer, onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    };
    document.addEventListener('keydown', onKey);
    layer.addEventListener('click', (event) => { if (event.target === layer) finish(false); });
    layer.querySelector('[data-close]')?.addEventListener('click', () => finish(false));
    layer.querySelector('[data-confirm]')?.addEventListener('click', () => finish(true));
    layer.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
  });
}

export function askDeleteEntity(root: HTMLElement, label: string): Promise<DeleteScope | null> {
  return new Promise((resolve) => {
    const layer = overlay(root, `
      <div class="pmd-confirm">
        <h2 class="pmd-title piecemaker-display">Supprimer cet élément et ses relations ?</h2>
        <div class="pmd-confirm-choices">
          <button type="button" class="pmd-confirm-choice" data-delete-scope="dossier"><strong>Exclure de ce dossier</strong><small>« ${escapeHtml(label)} » est supprimé et l’analyse ne le recréera plus dans ce dossier.</small></button>
          <button type="button" class="pmd-confirm-choice" data-delete-scope="tous"><strong>Ajouter à la liste des exclusions</strong><small>« ${escapeHtml(label)} » n’est plus jamais pseudonymisé, dans aucun dossier.</small></button>
        </div>
        <div class="pmd-form-actions">
          <button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Annuler</button>
        </div>
      </div>`);
    let settled = false;
    const finish = (scope: DeleteScope | null) => {
      if (settled) return;
      settled = true;
      closeOverlay(layer, onKey);
      resolve(scope);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
    };
    document.addEventListener('keydown', onKey);
    layer.addEventListener('click', (event) => { if (event.target === layer) finish(null); });
    layer.querySelector('[data-close]')?.addEventListener('click', () => finish(null));
    layer.querySelectorAll<HTMLElement>('[data-delete-scope]').forEach((button) => button.addEventListener('click', () => finish(button.dataset.deleteScope === 'tous' ? 'tous' : 'dossier')));
  });
}

export async function deleteEntity(root: HTMLElement, node: KnowledgeNode, variants: string[], save: (operations: KnowledgeUpdateOperation[]) => Promise<void>): Promise<boolean> {
  const scope = await askDeleteEntity(root, node.label);
  if (!scope) return false;
  if (scope === 'tous') {
    const { terms } = await knowledgeApi.institutionalTerms();
    if (!terms.includes(node.label)) await knowledgeApi.saveInstitutionalTerms([...terms, node.label]);
  }
  await save(deleteEntityOperations(node.id, [node.label, ...variants], scope));
  return true;
}

export function askEntity(root: HTMLElement, title: string, entries: Array<{ id: string; label: string; detail: string }>): Promise<string | null> {
  return new Promise((resolve) => {
    const layer = overlay(root, `
      <div class="pmd-confirm">
        <h2 class="pmd-title piecemaker-display">${escapeHtml(title)}</h2>
        <div class="pmd-entity-choice-list">${entries.map((entry) => `<button type="button" class="pmd-confirm-choice" data-entity-choice="${escapeHtml(entry.id)}"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.detail)}</small></button>`).join('') || '<p class="pmd-document-muted">Aucune personne dans le dossier.</p>'}</div>
        <div class="pmd-form-actions">
          <button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Annuler</button>
        </div>
      </div>`);
    let settled = false;
    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      closeOverlay(layer, onKey);
      resolve(id);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
    };
    document.addEventListener('keydown', onKey);
    layer.addEventListener('click', (event) => { if (event.target === layer) finish(null); });
    layer.querySelector('[data-close]')?.addEventListener('click', () => finish(null));
    layer.querySelectorAll<HTMLElement>('[data-entity-choice]').forEach((button) => button.addEventListener('click', () => finish(button.dataset.entityChoice || null)));
  });
}

export function askPrompt(root: HTMLElement, title: string, value = '', confirmLabel = 'Enregistrer'): Promise<string | null> {
  return new Promise((resolve) => {
    const layer = overlay(root, `
      <form class="pmd-confirm" data-prompt-form>
        <h2 class="pmd-title piecemaker-display">${escapeHtml(title)}</h2>
        <input class="pmd-input" name="value" value="${escapeHtml(value)}" autocomplete="off">
        <div class="pmd-form-actions">
          <button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Annuler</button>
          <button type="submit" class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`);
    const input = layer.querySelector<HTMLInputElement>('input[name="value"]');
    let settled = false;
    const finish = (next: string | null) => {
      if (settled) return;
      settled = true;
      closeOverlay(layer, onKey);
      resolve(next);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
    };
    document.addEventListener('keydown', onKey);
    layer.addEventListener('click', (event) => { if (event.target === layer) finish(null); });
    layer.querySelector('[data-close]')?.addEventListener('click', () => finish(null));
    layer.querySelector<HTMLFormElement>('[data-prompt-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      finish(input?.value.trim() || null);
    });
    input?.focus();
    input?.select();
  });
}

export function bindCitationToggles(container: HTMLElement | null): void {
  container?.addEventListener('click', (event) => {
    const text = (event.target as HTMLElement).closest<HTMLElement>('[data-toggle-citation]');
    if (text) text.dataset.expanded = String(text.dataset.expanded !== 'true');
  });
}

const positionOptions = (selected: string): string => ['<option value="">Non précisée</option>', ...PROCEDURE_POSITIONS.map((entry) => `<option value="${entry.value}" ${entry.value === selected ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`)].join('');

const kindOptions = (selected: NodeKind): string => entityKinds.map((kind) => `<option value="${kind}" ${kind === selected ? 'selected' : ''}>${escapeHtml(kindLabels[kind])}</option>`).join('');

export function bindAliasEditors(layer: HTMLElement): void {
  layer.querySelectorAll<HTMLElement>('[data-alias-editor]').forEach((editor) => {
    const pills = editor.querySelector<HTMLElement>('[data-alias-pills]');
    const input = editor.querySelector<HTMLInputElement>('[data-alias-input]');
    const hidden = editor.querySelector<HTMLInputElement>('input[name="aliases"]');
    if (!pills || !hidden) return;
    editor.addEventListener('click', (event) => { if (event.target === editor || event.target === pills) input?.focus(); });
    const aliases = parseAliases(hidden.value);
    const sync = () => {
      hidden.value = aliases.join('\n');
      pills.innerHTML = aliases.map((alias, index) => `<span class="pmd-alias-pill">${escapeHtml(alias)}<button type="button" data-remove-alias="${index}" aria-label="Supprimer ${escapeHtml(alias)}">×</button></span>`).join('');
      pills.querySelectorAll<HTMLButtonElement>('[data-remove-alias]').forEach((button) => button.addEventListener('click', () => {
        aliases.splice(Number(button.dataset.removeAlias), 1);
        sync();
        input?.focus();
      }));
    };
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const alias = input.value.trim();
      if (!alias || aliases.includes(alias)) {
        input.value = '';
        return;
      }
      aliases.push(alias);
      input.value = '';
      sync();
    });
    sync();
  });
}

const defaultRelationOptions = [
  'dirigeant',
  'avocat',
  'client',
  'partie adverse',
  'adresse',
  'IBAN',
  'SIREN',
  'téléphone',
  'URL',
  'représentant',
  'bénéficiaire',
  'employeur',
  'salarié',
  'associé',
  'filiale',
  'maison mère',
  'conjoint',
  'parent',
  'enfant',
  'mandataire',
  'propriétaire',
  'locataire',
];
const customRelationOptions = new Set<string>();

const relationOptions = (): string[] => [...defaultRelationOptions, ...customRelationOptions];

const relationSelectOptions = (): string => [
  '<option value="">Choisir une relation</option>',
  ...relationOptions().map((relation) => `<option value="${escapeHtml(relation)}">${escapeHtml(relation)}</option>`),
  '<option value="__custom__">Relation personnalisée…</option>',
].join('');

const relationLabel = (relation: string): string => relation === 'mentions'
  ? 'Mentionné dans'
  : relation ? `${relation.charAt(0).toLocaleUpperCase('fr-FR')}${relation.slice(1)}` : 'Relation';

export type PartyEditorDefaults = {
  kind?: 'person' | 'company';
  partySide?: 'client' | 'adversaire' | 'tiers';
};

const profilePersonIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="4"></circle><path d="M5 20v-2a7 7 0 0 1 14 0v2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z"></path></svg>';
const profileCompanyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V7l8-4 8 4v14H4ZM9 21v-5h6v5M8 9h1m6 0h1M8 12h1m6 0h1"></path></svg>';
const profileTagIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 12 9 9 9-9V3h-9L3 12Z"></path><circle cx="16" cy="8" r="1"></circle></svg>';
const profileFileIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6"></path></svg>';
const profileSirenIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 8 4v6c0 4-8 8-8 8s-8-4-8-8V7l8-4Z"></path><circle cx="12" cy="10" r="2"></circle><path d="M12 12v3"></path></svg>';

function companyIdentitySearch(root: HTMLElement, query: string, apply: (result: CompanySearchResult) => Promise<void>): void {
  const layer = modal(root, `<div class="pmd-company-search-dialog" role="dialog" aria-modal="true" aria-label="Recherche d’identité Registre Public">
    <div class="pmd-toolbar"><h2 class="pmd-title piecemaker-display">Registre Public</h2><span class="pmd-spacer"></span><button type="button" class="pmd-icon-button" data-close aria-label="Fermer la recherche">×</button></div>
    <form class="pmd-company-query" data-company-query><input class="pmd-input" name="query" aria-label="Nom ou SIREN" value="${escapeHtml(query)}" placeholder="Nom, SIREN ou SIRET" required><button class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm">Rechercher</button></form>
    <p class="pmd-form-note" data-company-status role="status"></p><div class="pmd-company-search-results" data-company-results></div>
  </div>`);
  layer.querySelector('.pmd-dialog')?.classList.add('pmd-dialog-compact');
  const form = layer.querySelector<HTMLFormElement>('[data-company-query]')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;
  const status = layer.querySelector<HTMLElement>('[data-company-status]')!;
  const results = layer.querySelector<HTMLElement>('[data-company-results]')!;
  const search = async () => {
    const value = input.value.trim();
    if (!value || button.disabled) return;
    button.disabled = true;
    results.replaceChildren();
    status.textContent = 'Recherche dans le Registre Public…';
    status.classList.remove('pmd-error');
    try {
      const response = await knowledgeApi.searchCompanies(value);
      if (!layer.isConnected) return;
      status.textContent = response.results.length ? `${response.results.length} société${response.results.length > 1 ? 's' : ''} proposée${response.results.length > 1 ? 's' : ''}` : 'Aucune société trouvée. Essayez un autre nom ou un SIREN.';
      results.innerHTML = response.results.map((result, index) => companySearchResultMarkup(result, '', index)).join('');
      results.querySelectorAll<HTMLButtonElement>('[data-company-result]').forEach((choice) => choice.addEventListener('click', async (event) => {
        event.stopPropagation();
        const choices = results.querySelectorAll<HTMLButtonElement>('[data-company-result]');
        choices.forEach((entry) => { entry.disabled = true; });
        button.disabled = true;
        try {
          await apply(response.results[Number(choice.dataset.companyResult)]);
          layer.remove();
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : 'Validation impossible.';
          status.classList.add('pmd-error');
          choices.forEach((entry) => { entry.disabled = false; });
          button.disabled = false;
        }
      }));
    } catch (error) {
      if (!layer.isConnected) return;
      status.textContent = error instanceof Error ? error.message : 'Recherche Registre Public impossible.';
      status.classList.add('pmd-error');
    } finally {
      button.disabled = false;
    }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); void search(); });
  input.focus();
  if (query.trim()) void search();
}

export function partyTypePicker(root: HTMLElement, side: 'client' | 'adversaire' | 'tiers', onSelect: (kind: 'person' | 'company') => void): HTMLElement {
  const sideLabel = side === 'client' ? 'cliente' : side === 'adversaire' ? 'adverse' : 'tierce';
  const layer = modal(root, `
    <div class="pmd-party-picker">
      <div class="pmd-toolbar"><div><h2 class="pmd-title piecemaker-display">Ajouter une partie ${sideLabel}</h2><div class="pmd-subtitle">Choisissez le type de partie à créer</div></div><span class="pmd-spacer"></span><button class="pmd-icon-button piecemaker-button piecemaker-button--icon" data-close aria-label="Fermer">×</button></div>
      <div class="pmd-party-picker-options">
        <button type="button" class="pmd-party-picker-option" data-party-kind="person"><span class="pmd-party-picker-icon pmd-party-picker-person">♙</span><span><strong>Personne physique</strong><small>Une personne</small></span></button>
        <button type="button" class="pmd-party-picker-option" data-party-kind="company"><span class="pmd-party-picker-icon pmd-party-picker-company">▦</span><span><strong>Personne morale</strong><small>Une société ou organisation</small></span></button>
      </div>
    </div>`);
  layer.querySelectorAll<HTMLElement>('[data-party-kind]').forEach((button) => button.addEventListener('click', () => {
    const kind = button.dataset.partyKind;
    if (kind === 'person' || kind === 'company') onSelect(kind);
    layer.remove();
  }));
  return layer;
}

export function nodeEditor(root: HTMLElement, data: ViewData, node: KnowledgeNode | null, save: (operations: KnowledgeUpdateOperation[]) => Promise<void>, defaults: PartyEditorDefaults = {}): void {
  const id = node?.id || `manual:${crypto.randomUUID()}`;
  const selectedKind = node?.kind || defaults.kind || 'person';
  const selectedSide = node ? (node.data.partySide === 'client' || node.data.partySide === 'adversaire' ? node.data.partySide : 'tiers') : defaults.partySide || 'client';
  const roleLabels = { client: 'Partie cliente', adversaire: 'Partie adverse', tiers: 'Tiers' };
  const mappings = node ? data.graph.mappings.filter((entry) => entry.nodeId === node.id) : [];
  const selectedPosition = node ? nodePosition(node) : '';
  const relations = node ? data.graph.links.filter((entry) => entry.fromNodeId === node.id || entry.toNodeId === node.id) : [];
  const nodesById = new Map(data.graph.nodes.map((entry) => [entry.id, entry]));
  const sirenNodes = data.graph.nodes.filter((entry) => entry.kind === 'siren');
  const linkedSiren = node ? relations.find((entry) => entry.relation.toLocaleLowerCase() === 'siren' && entry.fromNodeId === node.id && sirenNodes.some((candidate) => candidate.id === entry.toNodeId)) : undefined;
  const linkedSirenNode = linkedSiren ? sirenNodes.find((entry) => entry.id === linkedSiren.toNodeId) : undefined;
  const linkedAddress = relations.find((entry) => entry.fromNodeId === id && entry.relation.toLocaleLowerCase() === 'adresse' && nodesById.get(entry.toNodeId)?.kind === 'address');
  const linkedAddressNode = linkedAddress ? nodesById.get(linkedAddress.toNodeId) : undefined;
  const companyFieldsHidden = selectedKind !== 'company';
  const variants = node ? nodeVariants(node, data.graph.mappings) : [];
  const profileLinks = relations.map((relation, index) => {
    const relatedNodeId = relation.fromNodeId === id ? relation.toNodeId : relation.fromNodeId;
    const relatedNode = nodesById.get(relatedNodeId);
    return { relation, index, relatedNode, relatedNodeId };
  }).filter((entry) => entry.relation.relation !== 'mentions' && (entry.relatedNode?.kind === 'person' || entry.relatedNode?.kind === 'company'));
  const mentionCount = relations.filter((relation) => relation.relation === 'mentions').length;
  const entityCitations = node ? citationsOfEntity(data.graph.citations, node.id) : [];
  const linkTargets = data.graph.nodes.filter((entry) => entry.id !== id && (entry.kind === 'person' || entry.kind === 'company'));
  const layer = modal(root, `
    <div class="pmd-profile-editor" data-kind="${selectedKind}" data-side="${selectedSide}">
    <form class="pmd-form" data-node-form>
      <header class="pmd-profile-identity">
        <span class="pmd-profile-avatar" data-profile-avatar>${selectedKind === 'company' ? profileCompanyIcon : profilePersonIcon}</span>
        <div class="pmd-profile-identity-copy"><span class="pmd-profile-eyebrow" data-profile-role>${roleLabels[selectedSide]}</span><strong data-profile-name>${escapeHtml(node?.label || 'Nouvel élément')}</strong><span class="pmd-profile-kind" data-profile-kind>${escapeHtml(kindLabels[selectedKind])}</span></div>
        <span class="pmd-profile-watermark">${profileCompanyIcon}</span>
        <button type="button" class="pmd-icon-button pmd-profile-close" data-close aria-label="Fermer">×</button>
      </header>
      <section class="pmd-form-section pmd-profile-section"><div class="pmd-profile-section-heading"><h3>${profilePersonIcon}Informations principales</h3><button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-search-identity ${companyFieldsHidden ? 'hidden' : ''}>Registre Public</button></div>
      <div class="pmd-profile-info">
      <label>Type<span class="pmd-profile-field"><span class="pmd-profile-type-icon" data-profile-type-icon>${selectedKind === 'company' ? profileCompanyIcon : profilePersonIcon}</span><select class="pmd-select" name="kind">${kindOptions(selectedKind)}</select></span></label>
      <label>Adresse<span class="pmd-profile-field"><input class="pmd-input" name="address" value="${escapeHtml(linkedAddressNode?.label || '')}" placeholder="—"></span></label>
      <div class="pmd-profile-company-fields" data-company-fields ${companyFieldsHidden ? 'hidden' : ''}>
        <label>Forme sociale<span class="pmd-profile-field">${profileFileIcon}<input class="pmd-input" name="legalForm" value="${escapeHtml(textValue(node?.data.legalForm))}" placeholder="—"></span></label>
        <label>Numéro SIREN<span class="pmd-profile-field">${profileSirenIcon}<input class="pmd-input" name="siren" inputmode="numeric" autocomplete="off" value="${escapeHtml(linkedSirenNode?.label || '')}" placeholder="9 chiffres"></span><div class="pmd-siren-suggestions" data-siren-suggestions hidden></div></label>
        <label class="pmd-profile-capital">Capital social<span class="pmd-profile-field"><input class="pmd-input" name="capital" value="${escapeHtml(textValue(node?.data.capital))}" placeholder="Montant et devise"></span></label>
      </div>
      </div>
      <div class="pmd-profile-role-fields">
      <label>Rôle<select class="pmd-select" name="partySide">${Object.entries(roleLabels).map(([side, label]) => `<option value="${side}" ${side === selectedSide ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label data-position-field>Position<select class="pmd-select" name="position">${positionOptions(selectedPosition)}</select></label>
      </div>
      </section>
      <section class="pmd-form-section pmd-profile-section"><h3>${profileTagIcon}Anonymisation</h3>
      <div class="pmd-profile-info">
      <label>Nom principal<span class="pmd-profile-field">${profileTagIcon}<input class="pmd-input" name="label" value="${escapeHtml(node?.label || '')}" required></span></label>
      <label>Code anonymisé<textarea class="pmd-input pmd-profile-code" name="masked" rows="2" spellcheck="false">${escapeHtml(mappings[0]?.masked || '')}</textarea></label>
      <div class="pmd-profile-variants">Variantes détectées${aliasEditorMarkup(variants)}</div>
      </div>
      </section>
      <section class="pmd-form-section pmd-profile-section"><h3>${profileTagIcon}Liens</h3>
      ${profileLinks.length ? `<div class="pmd-current-relations"><div class="pmd-relation-list">${profileLinks.map(({ relation, index, relatedNode, relatedNodeId }) => {
        const relatedLabel = relatedNode?.label || relatedNodeId;
        const relatedKind = relatedNode?.kind === 'person' ? 'Personne physique' : 'Personne morale';
        return `<div class="pmd-relation-row"><span class="pmd-relation-copy"><span class="pmd-relation-type">${escapeHtml(relationLabel(relation.relation))}</span><strong class="pmd-relation-target">${escapeHtml(relatedLabel)}</strong><small class="pmd-relation-kind">${escapeHtml(relatedKind)}</small></span><button type="button" class="pmd-relation-remove" data-unlink="${index}" aria-label="Supprimer le lien ${escapeHtml(relationLabel(relation.relation))} avec ${escapeHtml(relatedLabel)}">×</button></div>`;
      }).join('')}</div></div>` : '<p class="pmd-form-note">Aucun lien avec une autre personne.</p>'}
      <div class="pmd-profile-link-fields">
      <label>Ajouter un lien<select class="pmd-select" name="target"><option value="">Personne ou société…</option>${linkTargets.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`).join('')}</select></label>
      <label>Nature du lien<select class="pmd-select" name="relation">${relationSelectOptions()}</select></label>
      </div>
      <label data-custom-relation hidden>Lien personnalisé<input class="pmd-input" name="customRelation" placeholder="Saisissez le type de lien"></label>
      ${mentionCount || entityCitations.length ? `<details class="pmd-profile-mentions"><summary>${mentionCount ? `Cité dans ${mentionCount} pièce${mentionCount > 1 ? 's' : ''}` : 'Citations des mentions'}</summary><p class="pmd-form-note">Mentions à corriger depuis la chronologie.</p>${citationListMarkup(entityCitations.map((citation) => ({ texte: citation.texte, source: citationSource(citation, data.graph.nodes) })))}</details>` : ''}
      </section>
      <p class="pmd-form-note pmd-button-danger" data-delete-error role="alert" hidden></p>
      <div class="pmd-form-actions">${node ? '<button type="button" class="pmd-button pmd-button-danger piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-delete-entity>Supprimer</button><span class="pmd-spacer"></span>' : ''}<button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Annuler</button><button class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm">Enregistrer</button></div>
    </form></div>`);
  layer.querySelector<HTMLButtonElement>('[data-delete-entity]')?.addEventListener('click', async (event) => {
    if (!node) return;
    const button = event.currentTarget as HTMLButtonElement;
    const errorSlot = layer.querySelector<HTMLElement>('[data-delete-error]')!;
    button.disabled = true;
    errorSlot.hidden = true;
    try {
      if (await deleteEntity(root, node, variants, save)) layer.remove();
    } catch (error) {
      errorSlot.textContent = error instanceof Error ? error.message : 'Suppression impossible.';
      errorSlot.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  const removals = new Set<number>();
  bindAliasEditors(layer);
  bindCitationToggles(layer);
  layer.querySelectorAll<HTMLElement>('[data-unlink]').forEach((button) => button.addEventListener('click', () => {
    removals.add(Number(button.dataset.unlink));
    button.closest('.pmd-relation-row')?.remove();
  }));
  const relationSelect = layer.querySelector<HTMLSelectElement>('select[name="relation"]');
  const customRelationField = layer.querySelector<HTMLElement>('[data-custom-relation]');
  const kindSelect = layer.querySelector<HTMLSelectElement>('select[name="kind"]');
  const companyFields = layer.querySelector<HTMLElement>('[data-company-fields]');
  const identitySearchButton = layer.querySelector<HTMLButtonElement>('[data-search-identity]');
  const sirenInput = layer.querySelector<HTMLInputElement>('input[name="siren"]');
  const sirenSuggestions = layer.querySelector<HTMLElement>('[data-siren-suggestions]');
  const normalizeSiren = (value: string): string => value.replace(/\D/g, '');
  const sirenMatches = (value: string): KnowledgeNode[] => {
    const query = normalizeSiren(value);
    if (!query) return sirenNodes.slice(0, 8);
    return sirenNodes.filter((candidate) => [candidate.label, ...candidate.aliases].some((entry) => normalizeSiren(entry).includes(query))).slice(0, 8);
  };
  const renderSirenSuggestions = () => {
    if (!sirenSuggestions || !sirenInput || kindSelect?.value !== 'company') return;
    const matches = sirenMatches(sirenInput.value);
    sirenSuggestions.innerHTML = matches.length ? matches.map((candidate) => `<button type="button" class="pmd-siren-suggestion" data-siren-id="${escapeHtml(candidate.id)}">${escapeHtml(candidate.label)}</button>`).join('') : '<span class="pmd-siren-no-match">Aucun SIREN repéré</span>';
    sirenSuggestions.hidden = !sirenInput.value.trim() && !matches.length;
    sirenSuggestions.querySelectorAll<HTMLElement>('[data-siren-id]').forEach((button) => button.addEventListener('click', () => {
      const candidate = sirenNodes.find((entry) => entry.id === button.dataset.sirenId);
      if (!candidate || !sirenInput) return;
      sirenInput.value = candidate.label;
      sirenSuggestions.hidden = true;
    }));
  };
  kindSelect?.addEventListener('change', () => {
    if (!companyFields || !kindSelect) return;
    companyFields.hidden = kindSelect.value !== 'company';
    if (identitySearchButton) identitySearchButton.hidden = companyFields.hidden;
    if (kindSelect.value === 'company') renderSirenSuggestions();
  });
  sirenInput?.addEventListener('input', renderSirenSuggestions);
  sirenInput?.addEventListener('focus', renderSirenSuggestions);
  const sideSelect = layer.querySelector<HTMLSelectElement>('select[name="partySide"]');
  const positionSelect = layer.querySelector<HTMLSelectElement>('select[name="position"]');
  const maskedInput = layer.querySelector<HTMLTextAreaElement>('textarea[name="masked"]');
  const initialMasked = maskedInput?.value || '';
  let maskedEdited = false;
  maskedInput?.addEventListener('input', () => { maskedEdited = true; maskedInput.setCustomValidity(''); });
  const legalFormInput = layer.querySelector<HTMLInputElement>('input[name="legalForm"]');
  const labelInput = layer.querySelector<HTMLInputElement>('input[name="label"]');
  const syncIdentity = () => {
    const name = layer.querySelector<HTMLElement>('[data-profile-name]');
    const kind = layer.querySelector<HTMLElement>('[data-profile-kind]');
    const role = layer.querySelector<HTMLElement>('[data-profile-role]');
    const avatar = layer.querySelector<HTMLElement>('[data-profile-avatar]');
    const typeIcon = layer.querySelector<HTMLElement>('[data-profile-type-icon]');
    const editor = layer.querySelector<HTMLElement>('.pmd-profile-editor');
    if (name) name.textContent = labelInput?.value.trim() || 'Nouvel élément';
    if (kind) kind.textContent = kindLabels[(kindSelect?.value || selectedKind) as NodeKind];
    const icon = kindSelect?.value === 'company' ? profileCompanyIcon : profilePersonIcon;
    if (avatar) avatar.innerHTML = icon;
    if (typeIcon) typeIcon.innerHTML = icon;
    const side = (sideSelect?.value || selectedSide) as keyof typeof roleLabels;
    if (role) role.textContent = roleLabels[side];
    if (editor) { editor.dataset.kind = kindSelect?.value || selectedKind; editor.dataset.side = side; }
  };
  labelInput?.addEventListener('input', syncIdentity);
  kindSelect?.addEventListener('change', syncIdentity);
  sideSelect?.addEventListener('change', syncIdentity);
  const renameApplies = (side: string): boolean => side === 'client' || side === 'adversaire' || Boolean(textValue(node?.data.originalCode)) || Boolean(node && isPartyCode(nodeCode(node)));
  const positionField = layer.querySelector<HTMLElement>('[data-position-field]');
  const syncPosition = () => {
    const isParty = sideSelect?.value === 'client' || sideSelect?.value === 'adversaire';
    if (positionField) positionField.hidden = !isParty;
    if (!isParty && positionSelect) positionSelect.value = '';
  };
  syncPosition();
  sideSelect?.addEventListener('change', syncPosition);
  identitySearchButton?.addEventListener('click', () => {
    const pseudonym = /^(?:CLIENT|ADVERSAIRE|PERSONNE_MORALE|PERSONNE_PHYSIQUE|PERS_MORALE|PERS_PHYSIQUE)(?:_|$)/;
    const name = labelInput?.value.trim() || '';
    const realName = !pseudonym.test(name) ? name : mappings.map((entry) => entry.real).find((value) => !pseudonym.test(value)) || '';
    const query = sirenInput?.value.trim() || [realName, legalFormInput?.value.trim()].filter(Boolean).join(' ');
    companyIdentitySearch(root, query, async (result) => {
      const form = new FormData(layer.querySelector<HTMLFormElement>('[data-node-form]')!);
      const currentNode = node ? { ...node, label: textValue(form.get('label')).trim(), aliases: parseAliases(form.get('aliases')) } : null;
      await save(buildCompanyValidationOperations(result, {
        nodeId: id, node: currentNode, partySide: textValue(form.get('partySide')) as PartySide, position: textValue(form.get('position')), legalForm: textValue(form.get('legalForm')), capital: textValue(form.get('capital')), maskedCode: maskedEdited ? textValue(form.get('masked')).trim() : undefined,
      }, data.graph));
      layer.remove();
    });
  });
  relationSelect?.addEventListener('change', () => {
    if (!customRelationField) return;
    customRelationField.hidden = relationSelect.value !== '__custom__';
    if (relationSelect.value === '__custom__') customRelationField.querySelector('input')?.focus();
  });
  layer.querySelector<HTMLFormElement>('[data-node-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const label = textValue(form.get('label')).trim();
    const savedAliases = parseAliases(form.get('aliases'));
    const masked = textValue(form.get('masked')).trim();
    const partySide = textValue(form.get('partySide'));
    const kind = textValue(form.get('kind')) as NodeKind;
    const legalForm = kind === 'company' ? textValue(form.get('legalForm')).trim() : '';
    const sirenValue = kind === 'company' ? normalizeSiren(textValue(form.get('siren'))) : '';
    const sirenNode = sirenValue ? sirenNodes.find((candidate) => [candidate.label, ...candidate.aliases].some((entry) => normalizeSiren(entry) === sirenValue)) : undefined;
    const position = textValue(form.get('position')).trim();
    const syncCode = renameApplies(partySide) || maskedEdited && Boolean(masked);
    const customCode = maskedEdited ? masked : node && (node.data.partySide === 'client' || node.data.partySide === 'adversaire') && !isPartyCode(initialMasked) ? initialMasked : undefined;
    try {
      if (customCode) partyCodeChange({ id, kind, data: node?.data || {} }, { kind, legalForm, side: partySide as PartySide, position }, data.graph.nodes, data.graph.mappings, data.graph.reservedCodes, customCode);
    } catch (error) {
      maskedInput?.setCustomValidity(error instanceof Error ? error.message : 'Code anonymisé invalide.');
      maskedInput?.reportValidity();
      return;
    }
    const nodeId = id;
    const code = initialMasked;
    const nodeData = { ...(node?.data || {}), partySide: partySide || null, position: (partySide === 'client' || partySide === 'adversaire') && position ? position : null, legalForm: legalForm || null, capital: kind === 'company' ? textValue(form.get('capital')).trim() || null : null };
    const operations: KnowledgeUpdateOperation[] = [];
    operations.push({ op: 'upsertNode', node: { id: nodeId, kind, label, aliases: savedAliases, data: nodeData } });
    for (const mapping of mappings) operations.push({ op: 'deleteMapping', mapping: { nodeId, real: mapping.real } });
    for (const real of [label, ...savedAliases]) if (code) operations.push({ op: 'upsertMapping', mapping: { nodeId, real, masked: code } });
    if (node) operations.push(...removedAliasOperations(nodeId, [node.label, ...variants], [label, ...savedAliases]));
    for (const index of removals) {
      const relation = relations[index];
      operations.push({ op: 'unlink', link: { fromNodeId: relation.fromNodeId, toNodeId: relation.toNodeId, relation: relation.relation } });
    }
    const target = textValue(form.get('target'));
    const selectedRelation = textValue(form.get('relation')).trim();
    const customRelation = textValue(form.get('customRelation')).trim();
    const relation = selectedRelation === '__custom__' ? customRelation : selectedRelation;
    if (selectedRelation === '__custom__' && customRelation) customRelationOptions.add(customRelation);
    if (target && relation) operations.push({ op: 'link', link: { fromNodeId: nodeId, toNodeId: target, relation } });
    if (sirenNode && !data.graph.links.some((link) => link.fromNodeId === id && link.toNodeId === sirenNode.id && link.relation.toLocaleLowerCase() === 'siren')) operations.push({ op: 'link', link: { fromNodeId: nodeId, toNodeId: sirenNode.id, relation: 'SIREN' } });
    const address = cleanSelection(textValue(form.get('address')));
    if (address !== cleanSelection(linkedAddressNode?.label || '')) {
      if (linkedAddress) operations.push({ op: 'unlink', link: { fromNodeId: nodeId, toNodeId: linkedAddress.toNodeId, relation: linkedAddress.relation } });
      if (address) {
        const existingAddress = data.graph.nodes.find((entry) => entry.kind === 'address' && [entry.label, ...entry.aliases].some((value) => cleanSelection(value).toLocaleLowerCase('fr-FR') === address.toLocaleLowerCase('fr-FR')));
        let addressId = existingAddress?.id;
        if (!addressId) {
          const addressCode = codeRegistry([code, ...data.graph.nodes.map(nodeCode), ...data.graph.mappings.map((entry) => entry.masked), ...(data.graph.reservedCodes || [])]).next('ADRESSE');
          addressId = `entity:${addressCode}`;
          operations.push({ op: 'upsertNode', node: { id: addressId, kind: 'address', label: address, aliases: [], data: { code: addressCode } } });
          operations.push({ op: 'upsertMapping', mapping: { nodeId: addressId, real: address, masked: addressCode } });
        }
        operations.push({ op: 'link', link: { fromNodeId: nodeId, toNodeId: addressId, relation: 'adresse' } });
      }
    }
    if (syncCode) operations.push({ op: 'syncPartyCode', nodeId, customCode });
    await save(operations);
    layer.remove();
  });
}

type HighlightCategory = 'client' | 'adverse' | 'tiers' | 'date' | 'fact';

export function documentEditor(root: HTMLElement, data: ViewData, node: KnowledgeNode, projectPath: string, save: (operations: KnowledgeUpdateOperation[]) => Promise<void>, rename: (piecePath: string, name: string) => Promise<void>): void {
  const mentionLinks = data.graph.links.filter((link) => link.relation === 'mentions' && (link.fromNodeId === node.id || link.toNodeId === node.id));
  const linked = new Set(mentionLinks.map((link) => link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId));
  const pathValue = textValue(node.data.path);
  const pieceName = node.label.replace(/\.[^.]+$/, '');
  const fields = Array.isArray(node.data.fields)
    ? node.data.fields.filter((field): field is { label: string; value: string } => Boolean(field) && typeof field === 'object' && typeof (field as { label?: unknown }).label === 'string' && typeof (field as { value?: unknown }).value === 'string')
    : [];
  const nature = textValue(node.data.nature);
  const natureOptions = natureOptionsMarkup(nature);
  const fieldRows = fields.map((field, index) => `<div class="pmd-document-field-row" data-field-row><input class="pmd-input" data-field-label value="${escapeHtml(field.label)}" placeholder="Libellé"><input class="pmd-input" data-field-value value="${escapeHtml(field.value)}" placeholder="Valeur"><button class="pmd-icon-button piecemaker-button piecemaker-button--icon" type="button" data-remove-field="${index}" aria-label="Supprimer le champ">×</button></div>`).join('');
  const layer = modal(root, `
    <div role="dialog" aria-modal="true" class="pmd-document-dialog" data-piecemaker-identity-highlight="off">
      <h2 class="pmd-sr-only">Corriger les métadonnées de la pièce</h2>
      <div class="pmd-document-dialog-body">
        <div class="pmd-document-preview-pane">
          <div class="pmd-document-preview-header"><span class="pmd-document-file-icon" aria-hidden="true">▤</span><p class="pmd-document-file-name">${escapeHtml(node.label)}</p></div>
          <div class="pmd-document-preview" data-document-preview><p class="pmd-document-muted">Chargement de la pièce…</p></div>
        </div>
        <form class="pmd-document-form" data-document-form>
          <div class="pmd-document-form-header"><h3>Corriger la pièce</h3></div>
          <div class="pmd-document-form-body">
            <div class="pmd-document-grid">
              ${pathValue ? `<label class="pmd-document-wide">Nom de la pièce<input class="pmd-input" name="pieceName" placeholder="AAAA-MM-JJ_Type de pièce et précisions" value="${escapeHtml(pieceName)}"><button class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" type="button" data-propose-name>Proposer un nom</button></label>` : ''}
              <label class="pmd-document-wide">Type de pièce<select class="pmd-select" name="nature"><option value="">— Sélectionner —</option>${natureOptions}<option value="__piecemaker_custom_nature__">Autre type…</option></select><input class="pmd-input" name="customNature" placeholder="Saisissez le type de pièce" aria-label="Type de pièce personnalisé" hidden></label>
              <label>Date<input class="pmd-input" type="date" name="date" value="${escapeHtml(dateFor(node))}"></label>
              <label>Lieu<input class="pmd-input" name="localisation" placeholder="Ex. TJ de ADRESSE_02" value="${escapeHtml(textValue(node.data.localisation))}"></label>
            </div>
            <p class="pmd-document-muted pmd-selection-message" data-selection-message hidden></p>
            <div class="pmd-document-form-section"><span>Personnes citées</span><div class="pmd-document-entities" data-document-entities></div><select class="pmd-select pmd-document-entity-add" data-add-entity aria-label="Ajouter une personne citée"></select></div>
            <div class="pmd-document-form-section"><div class="pmd-document-section-heading"><span>Champs libres</span><button class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" type="button" data-add-field>＋ Ajouter</button></div><div data-fields>${fieldRows}</div><p class="pmd-document-muted" data-empty-fields ${fields.length ? 'hidden' : ''}>Aucun champ libre.</p></div>
          </div>
          <div class="pmd-document-form-actions"><button class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" type="button" data-close>Annuler</button><button class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm" type="submit" data-document-submit>Enregistrer</button></div>
        </form>
      </div>
    </div>`);
  const preview = layer.querySelector<HTMLElement>('[data-document-preview]');
  const selectedEntities = new Set(linked);
  let working: SelectionGraph = { nodes: data.graph.nodes, mappings: data.graph.mappings, reservedCodes: data.graph.reservedCodes };
  let previewContent = '';
  const queuedOperations: KnowledgeUpdateOperation[] = [];
  const renamedIds = new Map<string, string>();
  const renamed = (id: string): string => renamedIds.get(id) || id;
  const removedCitationIds = new Set<number>();
  const pendingCitations: PendingCitation[] = [];
  const selectionValues: Record<'date' | 'fact', string[]> = { date: [], fact: [] };
  const dateInput = layer.querySelector<HTMLInputElement>('input[name="date"]');
  const readFields = () => Array.from(layer.querySelectorAll<HTMLElement>('[data-field-row]')).map((row) => ({ label: row.querySelector<HTMLInputElement>('[data-field-label]')?.value.trim() || '', value: row.querySelector<HTMLInputElement>('[data-field-value]')?.value.trim() || '' })).filter((field) => field.label || field.value);
  const datePreviewValues = (): string[] => {
    const iso = dateInput?.value || dateFor(node);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const numeric = match ? [`${match[3]}/${match[2]}/${match[1]}`, `${match[3]}-${match[2]}-${match[1]}`, `${match[3]}.${match[2]}.${match[1]}`] : [];
    return [textValue(node.data.doc_date), textValue(node.data.date), iso, ...numeric, ...selectionValues.date].filter(Boolean);
  };
  const sideOf = (entry: KnowledgeNode): 'client' | 'adverse' | 'tiers' => entry.data.partySide === 'client' ? 'client' : entry.data.partySide === 'adversaire' ? 'adverse' : 'tiers';
  const mappedPreviewValues = (side: 'client' | 'adverse' | 'tiers' | null): string[] => {
    const nodesById = new Map(working.nodes.map((entry) => [entry.id, entry]));
    return working.mappings
      .filter((mapping) => {
        const entry = nodesById.get(mapping.nodeId);
        const party = entry?.kind === 'person' || entry?.kind === 'company';
        return side ? party && sideOf(entry) === side : !party;
      })
      .flatMap((mapping) => [mapping.real, mapping.masked])
      .filter(Boolean);
  };
  const previewValues = (category: HighlightCategory): string[] => {
    if (category === 'date') return datePreviewValues();
    if (category === 'fact') return [nature, textValue(node.data.localisation), ...readFields().flatMap((field) => [field.label, field.value]), ...selectionValues.fact, ...mappedPreviewValues(null)].filter(Boolean);
    return [...working.nodes.filter((entry) => (entry.kind === 'person' || entry.kind === 'company') && sideOf(entry) === category).flatMap((entry) => [entry.label, ...entry.aliases]), ...mappedPreviewValues(category)];
  };
  const highlightPreview = (content: string): string => {
    const categories: HighlightCategory[] = ['client', 'adverse', 'tiers', 'date', 'fact'];
    const spans: Array<{ start: number; end: number; category: HighlightCategory }> = [];
    for (const category of categories) {
      const values = [...new Set(previewValues(category))].sort((left, right) => right.length - left.length);
      if (!values.length) continue;
      const pattern = new RegExp(values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
      let match = pattern.exec(content);
      while (match) {
        if (!spans.some((span) => match!.index < span.end && match!.index + match![0].length > span.start)) spans.push({ start: match.index, end: match.index + match[0].length, category });
        match = pattern.exec(content);
      }
    }
    spans.sort((left, right) => left.start - right.start || right.end - left.end);
    let cursor = 0;
    return spans.map((span) => {
      const before = content.slice(cursor, span.start);
      cursor = span.end;
      return `${escapeHtml(before)}<mark class="pmd-highlight-${span.category}">${escapeHtml(content.slice(span.start, span.end))}</mark>`;
    }).join('') + escapeHtml(content.slice(cursor));
  };
  const setPreviewError = (message: string) => {
    if (preview) preview.innerHTML = `<p class="pmd-document-muted">${escapeHtml(message)}</p>`;
  };
  const renderPreview = () => {
    if (preview && previewContent) preview.innerHTML = `<pre>${highlightPreview(previewContent)}</pre>`;
  };
  const loadPreview = async () => {
    if (!pathValue) {
      setPreviewError('Cette pièce n’a pas de Markdown converti.');
      return;
    }
    try {
      const result = await knowledgeApi.document(projectPath, pathValue);
      previewContent = result.content;
      renderPreview();
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  };
  const renderFields = () => {
    const fieldsTarget = layer.querySelector<HTMLElement>('[data-fields]');
    const empty = layer.querySelector<HTMLElement>('[data-empty-fields]');
    if (fieldsTarget && empty) empty.hidden = fieldsTarget.querySelectorAll('[data-field-row]').length > 0;
  };
  const entityList = layer.querySelector<HTMLElement>('[data-document-entities]');
  const entityAdd = layer.querySelector<HTMLSelectElement>('[data-add-entity]');
  const citationEntries = (entityId: string) => [
    ...citationsOfMention(data.graph.citations, node.id, entityId, renamed)
      .filter((citation) => !removedCitationIds.has(citation.id))
      .map((citation) => ({ texte: citation.texte, source: citationSource(citation, data.graph.nodes), remove: { attribute: 'data-remove-citation', value: String(citation.id) } })),
    ...pendingCitations
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => renamed(entry.entityId) === entityId)
      .map(({ entry, index }) => ({ texte: entry.texte, source: node.label, remove: { attribute: 'data-remove-pending', value: String(index) } })),
  ];
  const renderEntities = () => {
    const people = working.nodes
      .filter((entry) => entry.kind === 'person' || entry.kind === 'company')
      .sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));
    const cited = people.filter((entry) => selectedEntities.has(entry.id));
    const others = people.filter((entry) => !selectedEntities.has(entry.id));
    if (entityList) entityList.innerHTML = cited.map((entry) => {
      const entries = citationEntries(entry.id);
      return `<div class="pmd-document-cited" ${entries.length ? 'data-citations' : ''}><span class="pmd-document-entity" data-document-entity="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}<button type="button" class="pmd-document-entity-remove" data-remove-entity="${escapeHtml(entry.id)}" aria-label="Retirer ${escapeHtml(entry.label)}">×</button></span>${citationListMarkup(entries)}</div>`;
    }).join('')
      || '<p class="pmd-document-muted">Aucune personne citée. Sélectionnez un nom dans la pièce puis faites un clic droit.</p>';
    if (entityAdd) {
      entityAdd.innerHTML = `<option value="">＋ Ajouter une personne du dossier…</option>${others.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`).join('')}`;
      entityAdd.hidden = others.length === 0;
    }
  };
  entityList?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const removedCitation = target.closest<HTMLElement>('[data-remove-citation]')?.dataset.removeCitation;
    if (removedCitation) {
      removedCitationIds.add(Number(removedCitation));
      renderEntities();
      return;
    }
    const removedPending = target.closest<HTMLElement>('[data-remove-pending]')?.dataset.removePending;
    if (removedPending) {
      pendingCitations.splice(Number(removedPending), 1);
      renderEntities();
      return;
    }
    const id = target.closest<HTMLElement>('[data-remove-entity]')?.dataset.removeEntity;
    if (!id) return;
    selectedEntities.delete(id);
    renderEntities();
  });
  bindCitationToggles(entityList);
  entityAdd?.addEventListener('change', () => {
    if (!entityAdd.value) return;
    selectedEntities.add(entityAdd.value);
    renderEntities();
  });
  renderEntities();
  const addFieldRow = (value = '') => {
    const fieldsTarget = layer.querySelector<HTMLElement>('[data-fields]');
    if (!fieldsTarget) return;
    fieldsTarget.insertAdjacentHTML('beforeend', '<div class="pmd-document-field-row" data-field-row><input class="pmd-input" data-field-label placeholder="Libellé"><input class="pmd-input" data-field-value placeholder="Valeur"><button class="pmd-icon-button piecemaker-button piecemaker-button--icon" type="button" data-remove-field aria-label="Supprimer le champ">×</button></div>');
    const row = layer.querySelector<HTMLElement>('[data-fields] [data-field-row]:last-child');
    const valueInput = row?.querySelector<HTMLInputElement>('[data-field-value]');
    if (valueInput) valueInput.value = value;
    row?.querySelector<HTMLInputElement>('[data-field-label]')?.focus();
    renderFields();
  };
  layer.querySelector<HTMLElement>('[data-add-field]')?.addEventListener('click', () => addFieldRow());
  const customNatureInput = layer.querySelector<HTMLInputElement>('input[name="customNature"]');
  layer.querySelector<HTMLSelectElement>('select[name="nature"]')?.addEventListener('change', (event) => {
    if (!customNatureInput) return;
    customNatureInput.hidden = (event.target as HTMLSelectElement).value !== '__piecemaker_custom_nature__';
    if (!customNatureInput.hidden) customNatureInput.focus();
  });
  layer.querySelector<HTMLElement>('[data-propose-name]')?.addEventListener('click', () => {
    const natureSelect = layer.querySelector<HTMLSelectElement>('select[name="nature"]');
    const type = natureSelect?.value === '__piecemaker_custom_nature__' ? customNatureInput?.value || '' : natureSelect?.value || '';
    const proposal = proposedPieceName(dateInput?.value || '', type, layer.querySelector<HTMLInputElement>('input[name="localisation"]')?.value || '');
    const nameInput = layer.querySelector<HTMLInputElement>('input[name="pieceName"]');
    showSelectionMessage(proposal ? '' : 'Renseignez la date et le type de pièce pour proposer un nom.');
    if (proposal && nameInput) {
      nameInput.value = proposal;
      nameInput.focus();
    }
  });
  layer.addEventListener('click', (event) => {
    const remove = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-field]');
    if (!remove) return;
    remove.closest('[data-field-row]')?.remove();
    renderFields();
  });
  layer.querySelector<HTMLFormElement>('[data-document-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = layer.querySelector<HTMLButtonElement>('[data-document-submit]');
    if (submit?.disabled) return;
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Enregistrement…';
    }
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const natureSelection = textValue(form.get('nature'));
    const customNature = natureSelection === '__piecemaker_custom_nature__' ? textValue(form.get('customNature')).trim() : '';
    if (natureSelection === '__piecemaker_custom_nature__' && !customNature) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Enregistrer';
      }
      customNatureInput?.focus();
      return;
    }
    const savedNature = natureSelection === '__piecemaker_custom_nature__' ? customNature : natureSelection;
    const newName = textValue(form.get('pieceName')).trim();
    const documentFields = readFields();
    const operations: KnowledgeUpdateOperation[] = [...queuedOperations, {
      op: 'upsertNode',
      node: { id: node.id, kind: 'document', label: node.label, aliases: node.aliases, data: { ...node.data, nature: savedNature.trim() || null, localisation: textValue(form.get('localisation')).trim() || null, fields: documentFields }, date: textValue(form.get('date')) || null },
    }];
    operations.push(...pieceMentionOperations({ pieceId: node.id, mentionLinks, selected: selectedEntities, removedCitationIds, pending: pendingCitations, renamed }));
    try {
      await save(operations);
      if (pathValue && newName && newName !== pieceName) await rename(pathValue, newName);
      layer.remove();
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Enregistrer';
      }
    }
  });
  const selectionMessage = layer.querySelector<HTMLElement>('[data-selection-message]');
  const showSelectionMessage = (message: string) => {
    if (!selectionMessage) return;
    selectionMessage.textContent = message;
    selectionMessage.hidden = !message;
  };
  const applyEntityChange = (change: SelectionChange) => {
    queuedOperations.push(...change.operations);
    working = change.graph;
    if (change.previousId !== change.nodeId) {
      for (const [from, to] of renamedIds) if (to === change.previousId) renamedIds.set(from, change.nodeId);
      renamedIds.set(change.previousId, change.nodeId);
      selectedEntities.delete(change.previousId);
    }
    selectedEntities.add(change.nodeId);
    renderEntities();
    renderPreview();
  };
  const designateParty = (selection: string, side: 'client' | 'adversaire' | 'tiers') => {
    const existing = findEntityBySelection(selection, working);
    if (existing) {
      applyEntityChange(changeNodeSide(existing, side, working));
      return;
    }
    partyTypePicker(root, side, (kind) => applyEntityChange(createEntity(selection, kind, side, working)));
  };
  const chooseCategory = (category: HighlightCategory, selection: string) => {
    showSelectionMessage('');
    if (category === 'date') {
      const iso = parseSelectionDate(selection);
      if (!iso || !dateInput) {
        showSelectionMessage(`Date non reconnue : « ${selection} »`);
        return;
      }
      dateInput.value = iso;
      selectionValues.date.push(selection);
      renderPreview();
      return;
    }
    if (category === 'fact') {
      selectionValues.fact.push(selection);
      addFieldRow(selection);
      renderPreview();
      return;
    }
    designateParty(selection, category === 'adverse' ? 'adversaire' : category);
  };
  const menuCategories: Array<{ category: HighlightCategory; label: string }> = [
    { category: 'client', label: 'Partie cliente' },
    { category: 'adverse', label: 'Partie adverse' },
    { category: 'tiers', label: 'Tiers' },
    { category: 'date', label: 'Date' },
    { category: 'fact', label: 'Fait' },
  ];
  const citeSelection = async (selection: string) => {
    showSelectionMessage('');
    const entities = citableEntities(working.nodes, selectedEntities);
    const entityId = await askEntity(root, 'Citer pour…', entities.map((entry) => ({ id: entry.id, label: entry.label, detail: selectedEntities.has(entry.id) ? 'Citée dans la pièce' : kindLabels[entry.kind] })));
    if (!entityId) return;
    if (!pendingCitations.some((entry) => renamed(entry.entityId) === entityId && entry.texte === selection)) pendingCitations.push({ entityId, texte: selection });
    selectedEntities.add(entityId);
    renderEntities();
  };
  let closeSelectionMenu = () => {};
  const openSelectionMenu = (x: number, y: number, selection: string) => {
    closeSelectionMenu();
    const menu = document.createElement('div');
    menu.className = 'pmd-selection-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = menuCategories.map((entry) => `<button type="button" role="menuitem" data-selection-category="${entry.category}"><i aria-hidden="true"></i>${entry.label}</button>`).join('') + '<button type="button" role="menuitem" data-selection-cite>Citer pour…</button>';
    layer.appendChild(menu);
    const bounds = (layer.querySelector('.pmd-document-dialog') || layer).getBoundingClientRect();
    menu.style.left = `${Math.max(bounds.left + 4, Math.min(x, bounds.right - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(bounds.top + 4, Math.min(y, bounds.bottom - menu.offsetHeight - 4))}px`;
    const onOutside = (event: Event) => { if (!menu.contains(event.target as Node)) closeSelectionMenu(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeSelectionMenu(); };
    closeSelectionMenu = () => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      layer.removeEventListener('scroll', closeSelectionMenu, true);
      menu.remove();
      closeSelectionMenu = () => {};
    };
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    layer.addEventListener('scroll', closeSelectionMenu, true);
    menu.addEventListener('mousedown', (event) => event.preventDefault());
    menu.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-selection-cite]')) {
        closeSelectionMenu();
        void citeSelection(selection);
        return;
      }
      const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-selection-category]')?.dataset.selectionCategory as HighlightCategory | undefined;
      if (!choice) return;
      closeSelectionMenu();
      chooseCategory(choice, selection);
    });
  };
  preview?.addEventListener('contextmenu', (event) => {
    const range = window.getSelection();
    const selection = cleanSelection(range?.toString() || '');
    if (!preview || !range || range.isCollapsed || !selection || !preview.contains(range.anchorNode) || !preview.contains(range.focusNode)) return;
    event.preventDefault();
    openSelectionMenu(event.clientX, event.clientY, selection);
  });
  void loadPreview();
}

export function institutionalTermsEditor(root: HTMLElement, onClose?: () => void): HTMLElement {
  const layer = modal(root, `
    <div class="pmd-terms-editor">
      <div class="pmd-toolbar"><div><h2 class="pmd-title piecemaker-display">Termes institutionnels</h2><div class="pmd-subtitle">Jamais pseudonymisés, valables pour tous les dossiers</div></div><span class="pmd-spacer"></span><button class="pmd-icon-button piecemaker-button piecemaker-button--icon" data-close aria-label="Fermer">×</button></div>
      <form class="pmd-form" data-terms-form>
        <label>Liste<div class="pmd-alias-editor pmd-terms-list" data-terms-editor><div class="pmd-alias-pills" data-terms-pills></div><input class="pmd-input pmd-alias-input" data-terms-input placeholder="Chargement…" spellcheck="false" disabled></div></label>
        <div class="pmd-terms-status" data-terms-status></div>
        <div class="pmd-form-actions"><button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Annuler</button><button type="submit" class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm" data-terms-submit disabled>Enregistrer</button></div>
      </form>
    </div>`);
  const pills = layer.querySelector<HTMLElement>('[data-terms-pills]');
  const input = layer.querySelector<HTMLInputElement>('[data-terms-input]');
  const submit = layer.querySelector<HTMLButtonElement>('[data-terms-submit]');
  const status = layer.querySelector<HTMLElement>('[data-terms-status]');
  const terms: string[] = [];
  const setStatus = (message: string, failed = false) => {
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(failed);
  };
  const syncTerms = () => {
    if (!pills) return;
    pills.innerHTML = terms.map((term, index) => `<span class="pmd-alias-pill">${escapeHtml(term)}<button type="button" data-remove-term="${index}" aria-label="Supprimer ${escapeHtml(term)}">×</button></span>`).join('');
    pills.querySelectorAll<HTMLButtonElement>('[data-remove-term]').forEach((button) => button.addEventListener('click', async () => {
      const index = Number(button.dataset.removeTerm);
      const term = terms[index];
      if (!term || !await askConfirm(root, `Supprimer le terme « ${term} » ?`, 'Supprimer')) return;
      const current = terms.indexOf(term);
      if (current < 0) return;
      terms.splice(current, 1);
      syncTerms();
      input?.focus();
    }));
  };
  const addTerm = () => {
    if (!input) return;
    const term = input.value.trim();
    input.value = '';
    if (!term) return;
    if (terms.includes(term)) {
      setStatus(`« ${term} » figure déjà dans la liste.`);
      return;
    }
    terms.push(term);
    syncTerms();
    setStatus(`${terms.length} termes, non enregistrés.`);
  };
  input?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTerm();
  });
  layer.querySelector<HTMLElement>('[data-terms-editor]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) input?.focus();
  });
  layer.addEventListener('click', (event) => { if (event.target === layer) onClose?.(); });
  layer.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => onClose?.()));
  void knowledgeApi.institutionalTerms()
    .then((store) => {
      if (!input || !submit) return;
      terms.splice(0, terms.length, ...store.terms);
      syncTerms();
      input.disabled = false;
      input.placeholder = 'Saisissez un terme puis appuyez sur Entrée';
      submit.disabled = false;
      setStatus(`${store.terms.length} termes enregistrés.`);
    })
    .catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
  layer.querySelector<HTMLFormElement>('[data-terms-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input || !submit) return;
    addTerm();
    submit.disabled = true;
    setStatus('Enregistrement…');
    try {
      const store = await knowledgeApi.saveInstitutionalTerms(terms.slice());
      terms.splice(0, terms.length, ...store.terms);
      syncTerms();
      submit.disabled = false;
      setStatus(`${store.terms.length} termes enregistrés.`);
    } catch (error) {
      submit.disabled = false;
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
  return layer;
}
