import { entityKinds, escapeHtml, labels, textValue, dateFor } from './views.js';
import { knowledgeApi } from './api.js';
import type { CompanySearchResult } from './api.js';
import { buildCompanyValidationOperations } from './company-search.js';
import type { ViewData } from './views.js';
import type { KnowledgeNode, KnowledgeUpdateOperation, NodeKind } from './types.js';
import { PROCEDURE_POSITIONS, partyCodeChange } from './party-codes.js';
import type { PartySide } from './party-codes.js';

export function modal(root: HTMLElement, body: string): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pmd-modal';
  layer.innerHTML = `<div class="pmd-dialog">${body}</div>`;
  root.appendChild(layer);
  layer.addEventListener('click', (event) => { if (event.target === layer) layer.remove(); });
  layer.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => layer.remove()));
  return layer;
}

const positionOptions = (selected: string): string => ['<option value="">Non précisée</option>', ...PROCEDURE_POSITIONS.map((entry) => `<option value="${entry.value}" ${entry.value === selected ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`)].join('');

const kindOptions = (selected: NodeKind): string => entityKinds.map((kind) => `<option value="${kind}" ${kind === selected ? 'selected' : ''}>${escapeHtml(labels[kind])}</option>`).join('');

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

const pseudonymPattern = /^(?:CLIENT|ADVERSAIRE|PERSONNE_MORALE|PERSONNE_PHYSIQUE|PERS_MORALE|PERS_PHYSIQUE)(?:_|$)/;

const realCompanyName = (mappings: Array<{ real: string; masked: string }>, currentLabel: string): string => {
  const mappedName = mappings.map((mapping) => mapping.real.trim()).find((value) => value && !pseudonymPattern.test(value));
  if (mappedName) return mappedName;
  return currentLabel && !pseudonymPattern.test(currentLabel) ? currentLabel : 'Personne morale';
};

export type PartyEditorDefaults = {
  kind?: 'person' | 'company';
  partySide?: 'client' | 'adversaire' | 'tiers';
};

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

export function nodeEditor(root: HTMLElement, data: ViewData, node: KnowledgeNode | null, save: (operations: KnowledgeUpdateOperation[]) => Promise<void>, defaults: PartyEditorDefaults = {}, onBackToMapping?: () => void): void {
  const id = node?.id || `manual:${crypto.randomUUID()}`;
  const selectedKind = node?.kind || defaults.kind || 'person';
  const mappings = node ? data.graph.mappings.filter((entry) => entry.nodeId === node.id) : [];
  const relations = node ? data.graph.links.filter((entry) => entry.fromNodeId === node.id || entry.toNodeId === node.id) : [];
  const nodesById = new Map(data.graph.nodes.map((entry) => [entry.id, entry]));
  const sirenNodes = data.graph.nodes.filter((entry) => entry.kind === 'siren');
  const linkedSiren = node ? relations.find((entry) => entry.relation.toLocaleLowerCase() === 'siren' && entry.fromNodeId === node.id && sirenNodes.some((candidate) => candidate.id === entry.toNodeId)) : undefined;
  const linkedSirenNode = linkedSiren ? sirenNodes.find((entry) => entry.id === linkedSiren.toNodeId) : undefined;
  const companyFieldsHidden = selectedKind !== 'company';
  const initialAliases = [...new Set((node?.aliases || []).map((alias) => alias.trim()).filter(Boolean))];
  const companySearchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
  const layer = modal(root, `
    <div class="pmd-toolbar">${node && onBackToMapping ? '<button type="button" class="pmd-button pmd-back-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-back-mapping>← Retour</button>' : ''}<h2 class="pmd-title piecemaker-display">${node ? 'Modifier l’élément' : 'Ajouter un élément'}</h2><span class="pmd-spacer"></span><button type="button" class="pmd-icon-button piecemaker-button piecemaker-button--icon" data-action="company-search" aria-label="Rechercher cette personne morale" title="Rechercher dans Registre Public" ${selectedKind === 'company' ? '' : 'hidden'}>${companySearchIcon}</button><button class="pmd-icon-button piecemaker-button piecemaker-button--icon" data-close>×</button></div>
    <div class="pmd-dialog-columns"><form class="pmd-form" data-node-form>
      <label>Type<select class="pmd-select" name="kind">${kindOptions(node?.kind || defaults.kind || 'person')}</select></label>
      <label>Libellé<input class="pmd-input" name="label" value="${escapeHtml(node?.label || '')}" required></label>
      <label>Variantes<div class="pmd-alias-editor" data-alias-editor><div class="pmd-alias-pills" data-alias-pills></div><input class="pmd-input pmd-alias-input" data-alias-input placeholder="Saisissez une variante puis appuyez sur Entrée"><input type="hidden" name="aliases"></div></label>
      <label>Code anonymisé<input class="pmd-input" name="masked" value="${escapeHtml(mappings[0]?.masked || '')}"></label>
      <label>Statut procédural<select class="pmd-select" name="partySide"><option value="">Aucun</option><option value="client" ${(!node && defaults.partySide === 'client') || (node && node.data.partySide === 'client') || (!node && !defaults.partySide) ? 'selected' : ''}>Partie cliente</option><option value="adversaire" ${(node && node.data.partySide === 'adversaire') || (!node && defaults.partySide === 'adversaire') ? 'selected' : ''}>Partie adverse</option><option value="tiers" ${(node && node.data.partySide !== 'client' && node.data.partySide !== 'adversaire') || (!node && defaults.partySide === 'tiers') ? 'selected' : ''}>Tiers</option></select></label>
      <label data-position-field>Position procédurale<select class="pmd-select" name="position">${positionOptions(textValue(node?.data.position))}</select></label>
      <div data-company-fields ${companyFieldsHidden ? 'hidden' : ''}>
        <label>Forme sociale<input class="pmd-input" name="legalForm" value="${escapeHtml(textValue(node?.data.legalForm))}"></label>
        <label>Numéro SIREN<input class="pmd-input" name="siren" inputmode="numeric" autocomplete="off" value="${escapeHtml(linkedSirenNode?.label || '')}" placeholder="9 chiffres"><div class="pmd-siren-suggestions" data-siren-suggestions></div></label>
      </div>
      <label>Nouvelle relation<select class="pmd-select" name="target"><option value="">Aucune</option>${data.graph.nodes.filter((entry) => entry.id !== id && entry.kind !== 'document').map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`).join('')}</select></label>
      <label>Type de relation<select class="pmd-select" name="relation">${relationSelectOptions()}</select></label>
      <label data-custom-relation hidden>Relation personnalisée<input class="pmd-input" name="customRelation" placeholder="Saisissez une relation"></label>
      ${relations.length ? `<div class="pmd-current-relations"><div class="pmd-group">Relations actuelles <span class="pmd-group-count">${relations.length}</span></div><div class="pmd-relation-list">${relations.map((relation, index) => {
        const relatedNodeId = relation.fromNodeId === id ? relation.toNodeId : relation.fromNodeId;
        const relatedNode = nodesById.get(relatedNodeId);
        const relatedLabel = relatedNode?.label || relatedNodeId;
        const relatedKind = relatedNode?.kind === 'document' ? 'Pièce' : relatedNode?.kind === 'person' ? 'Personne physique' : relatedNode?.kind === 'company' ? 'Personne morale' : relatedNode ? labels[relatedNode.kind] : '';
        return `<button type="button" class="pmd-relation-row" data-unlink="${index}" aria-label="Supprimer le lien ${escapeHtml(relationLabel(relation.relation))} avec ${escapeHtml(relatedLabel)}"><span class="pmd-relation-copy"><span class="pmd-relation-type">${escapeHtml(relationLabel(relation.relation))}</span><strong class="pmd-relation-target">${escapeHtml(relatedLabel)}</strong>${relatedKind ? `<small class="pmd-relation-kind">${escapeHtml(relatedKind)}</small>` : ''}</span><span class="pmd-relation-remove" aria-hidden="true">×</span></button>`;
      }).join('')}</div></div>` : ''}
      <div class="pmd-form-actions"><button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Annuler</button><button class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm">Enregistrer</button></div>
    </form><aside class="pmd-company-search" data-company-search hidden></aside></div>`);
  layer.querySelector<HTMLElement>('[data-back-mapping]')?.addEventListener('click', () => {
    layer.remove();
    onBackToMapping?.();
  });
  const removals = new Set<number>();
  const aliasEditor = layer.querySelector<HTMLElement>('[data-alias-editor]');
  const aliasPills = layer.querySelector<HTMLElement>('[data-alias-pills]');
  const aliasInput = layer.querySelector<HTMLInputElement>('[data-alias-input]');
  const aliases = initialAliases.slice();
  const syncAliases = () => {
    if (!aliasEditor || !aliasPills) return;
    aliasPills.innerHTML = aliases.map((alias, index) => `<span class="pmd-alias-pill">${escapeHtml(alias)}<button type="button" data-remove-alias="${index}" aria-label="Supprimer ${escapeHtml(alias)}">×</button></span>`).join('');
    const hidden = aliasEditor.querySelector<HTMLInputElement>('input[name="aliases"]');
    if (hidden) hidden.value = aliases.join('\n');
    aliasPills.querySelectorAll<HTMLButtonElement>('[data-remove-alias]').forEach((button) => button.addEventListener('click', () => {
      aliases.splice(Number(button.dataset.removeAlias), 1);
      syncAliases();
      aliasInput?.focus();
    }));
  };
  const addAlias = () => {
    if (!aliasInput) return;
    const alias = aliasInput.value.trim();
    if (!alias || aliases.includes(alias)) {
      aliasInput.value = '';
      return;
    }
    aliases.push(alias);
    aliasInput.value = '';
    syncAliases();
  };
  aliasInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addAlias();
  });
  syncAliases();
  layer.querySelectorAll<HTMLElement>('[data-unlink]').forEach((button) => button.addEventListener('click', () => {
    removals.add(Number(button.dataset.unlink));
    button.style.display = 'none';
  }));
  const relationSelect = layer.querySelector<HTMLSelectElement>('select[name="relation"]');
  const customRelationField = layer.querySelector<HTMLElement>('[data-custom-relation]');
  const kindSelect = layer.querySelector<HTMLSelectElement>('select[name="kind"]');
  const companyFields = layer.querySelector<HTMLElement>('[data-company-fields]');
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
  const companySearchButton = layer.querySelector<HTMLElement>('[data-action=company-search]');
  kindSelect?.addEventListener('change', () => {
    if (!companyFields || !kindSelect) return;
    companyFields.hidden = kindSelect.value !== 'company';
    if (companySearchButton) companySearchButton.hidden = kindSelect.value !== 'company';
    if (kindSelect.value === 'company') renderSirenSuggestions();
  });
  sirenInput?.addEventListener('input', renderSirenSuggestions);
  sirenInput?.addEventListener('focus', renderSirenSuggestions);
  renderSirenSuggestions();
  const sideSelect = layer.querySelector<HTMLSelectElement>('select[name="partySide"]');
  const positionSelect = layer.querySelector<HTMLSelectElement>('select[name="position"]');
  const maskedInput = layer.querySelector<HTMLInputElement>('input[name="masked"]');
  const legalFormInput = layer.querySelector<HTMLInputElement>('input[name="legalForm"]');
  const labelInput = layer.querySelector<HTMLInputElement>('input[name="label"]');
  const companySearchPanel = layer.querySelector<HTMLElement>('[data-company-search]');
  let companySearchResults: CompanySearchResult[] = [];
  let companySearchBusy = false;
  let companySearchError = '';
  const companySearchName = (): string => realCompanyName(mappings, labelInput?.value?.trim() || '');
  const companySearchQuery = (): string => {
    const name = companySearchName();
    const terms = name && name !== 'Personne morale' ? [name] : [];
    for (const value of [legalFormInput?.value, sirenInput?.value]) {
      const term = value?.trim();
      if (term && term !== 'Personne morale') terms.push(term);
    }
    return terms.join(' ');
  };
  const renderCompanySearchPanel = () => {
    if (!companySearchPanel) return;
    companySearchPanel.hidden = false;
    const message = companySearchBusy ? '<p class="pmd-company-search-status">Recherche en cours…</p>' : companySearchError ? `<p class="pmd-company-search-status pmd-company-search-error">${escapeHtml(companySearchError)}</p>` : !companySearchResults.length ? '<p class="pmd-company-search-status">Aucun résultat.</p>' : '';
    companySearchPanel.innerHTML = `<div class="pmd-company-search-header"><div><h3>Registre Public</h3><p>Résultats pour ${escapeHtml(companySearchName())}</p></div></div><div class="pmd-company-search-results">${message}${companySearchResults.map((result, index) => `<article class="pmd-company-result"><h4>${escapeHtml(result.name)}</h4><p>${escapeHtml(result.summary)}</p><dl><div><dt>SIREN</dt><dd>${escapeHtml(result.fields.siren || result.siren)}</dd></div>${result.fields.address ? `<div><dt>Siège</dt><dd>${escapeHtml(result.fields.address)}</dd></div>` : ''}${result.fields.directors.length ? `<div><dt>Dirigeants</dt><dd>${escapeHtml(result.fields.directors.map((director) => director.name).join(', '))}</dd></div>` : ''}</dl>${result.url ? `<a class="pmd-company-result-link" href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">Vérifier la fiche officielle ↗</a>` : ''}<details><summary>Voir toutes les informations</summary><pre>${escapeHtml(result.details)}</pre></details><button type="button" class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm pmd-company-validate" data-company-result="${index}">Valider cette personne morale</button></article>`).join('')}</div>`;
    companySearchPanel.querySelectorAll<HTMLElement>('[data-company-result]').forEach((button) => button.addEventListener('click', async () => {
      const result = companySearchResults[Number(button.dataset.companyResult)];
      if (!result || !data) return;
      companySearchBusy = true;
      companySearchError = '';
      renderCompanySearchPanel();
      try {
        const operations = buildCompanyValidationOperations(result, {
          nodeId: id,
          node,
          partySide: (sideSelect?.value || '') as PartySide,
          position: positionSelect?.value || '',
          legalForm: legalFormInput?.value || '',
        }, data.graph);
        await save(operations);
        layer.remove();
      } catch (error) {
        companySearchError = error instanceof Error ? error.message : 'Validation impossible.';
      } finally {
        companySearchBusy = false;
        if (companySearchPanel.isConnected) renderCompanySearchPanel();
      }
    }));
  };
  layer.querySelector<HTMLElement>('[data-action=company-search]')?.addEventListener('click', async () => {
    if (companySearchBusy) return;
    const query = companySearchQuery();
    if (!query) {
      companySearchError = 'Saisissez un nom, une forme sociale ou un SIREN.';
      renderCompanySearchPanel();
      return;
    }
    companySearchBusy = true;
    companySearchError = '';
    companySearchResults = [];
    renderCompanySearchPanel();
    try {
      const response = await knowledgeApi.searchCompanies(query);
      companySearchResults = response.results;
    } catch (error) {
      companySearchError = error instanceof Error ? error.message : 'Recherche impossible.';
    } finally {
      companySearchBusy = false;
      renderCompanySearchPanel();
    }
  });
  const renameApplies = (side: string): boolean => side === 'client' || side === 'adversaire' || Boolean(textValue(node?.data.originalCode));
  const codeChangeFor = (side: string) => partyCodeChange(
    { id, kind: (kindSelect?.value || selectedKind) as NodeKind, data: node?.data || {} },
    { kind: (kindSelect?.value || selectedKind) as NodeKind, legalForm: legalFormInput?.value || '', side: side as PartySide, position: positionSelect?.value || '' },
    data.graph.nodes,
    data.graph.mappings,
  );
  const syncMasked = () => {
    const side = sideSelect?.value || '';
    if (!maskedInput) return;
    maskedInput.readOnly = side === 'client' || side === 'adversaire';
    if (renameApplies(side)) maskedInput.value = codeChangeFor(side).code;
  };
  sideSelect?.addEventListener('change', syncMasked);
  positionSelect?.addEventListener('change', syncMasked);
  kindSelect?.addEventListener('change', syncMasked);
  legalFormInput?.addEventListener('input', syncMasked);
  if (maskedInput) maskedInput.readOnly = sideSelect?.value === 'client' || sideSelect?.value === 'adversaire';
  relationSelect?.addEventListener('change', () => {
    if (!customRelationField) return;
    customRelationField.hidden = relationSelect.value !== '__custom__';
    if (relationSelect.value === '__custom__') customRelationField.querySelector('input')?.focus();
  });
  layer.querySelector<HTMLFormElement>('[data-node-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const label = textValue(form.get('label')).trim();
    const savedAliases = textValue(form.get('aliases')).split('\n').map((entry) => entry.trim()).filter(Boolean);
    const masked = textValue(form.get('masked')).trim();
    const partySide = textValue(form.get('partySide'));
    const kind = textValue(form.get('kind')) as NodeKind;
    const legalForm = kind === 'company' ? textValue(form.get('legalForm')).trim() : '';
    const sirenValue = kind === 'company' ? normalizeSiren(textValue(form.get('siren'))) : '';
    const sirenNode = sirenValue ? sirenNodes.find((candidate) => [candidate.label, ...candidate.aliases].some((entry) => normalizeSiren(entry) === sirenValue)) : undefined;
    const position = textValue(form.get('position')).trim();
    const change = renameApplies(partySide)
      ? partyCodeChange({ id, kind, data: node?.data || {} }, { kind, legalForm, side: partySide as PartySide, position }, data.graph.nodes, data.graph.mappings)
      : null;
    const nodeId = change ? change.nodeId : id;
    const code = change ? change.code : masked;
    const nodeData = change ? change.data : { ...(node?.data || {}), partySide: partySide || null, legalForm: legalForm || null, position: position || null };
    const rename = (value: string): string => value === id ? nodeId : value;
    const operations: KnowledgeUpdateOperation[] = [];
    if (change && node && nodeId !== id) operations.push(...change.operations);
    operations.push({ op: 'upsertNode', node: { id: nodeId, kind, label, aliases: savedAliases, data: nodeData, origin: 'manual' } });
    for (const mapping of mappings) operations.push({ op: 'deleteMapping', mapping: { nodeId, real: mapping.real } });
    for (const real of [label, ...savedAliases]) if (code) operations.push({ op: 'upsertMapping', mapping: { nodeId, real, masked: code, origin: 'manual' } });
    for (const index of removals) {
      const relation = relations[index];
      operations.push({ op: 'unlink', link: { fromNodeId: rename(relation.fromNodeId), toNodeId: rename(relation.toNodeId), relation: relation.relation } });
    }
    const target = textValue(form.get('target'));
    const selectedRelation = textValue(form.get('relation')).trim();
    const customRelation = textValue(form.get('customRelation')).trim();
    const relation = selectedRelation === '__custom__' ? customRelation : selectedRelation;
    if (selectedRelation === '__custom__' && customRelation) customRelationOptions.add(customRelation);
    if (target && relation) operations.push({ op: 'link', link: { fromNodeId: nodeId, toNodeId: target, relation, origin: 'manual' } });
    if (sirenNode && !data.graph.links.some((link) => link.fromNodeId === id && link.toNodeId === sirenNode.id && link.relation.toLocaleLowerCase() === 'siren')) operations.push({ op: 'link', link: { fromNodeId: nodeId, toNodeId: sirenNode.id, relation: 'SIREN', origin: 'manual' } });
    await save(operations);
    layer.remove();
  });
}

export function documentEditor(root: HTMLElement, data: ViewData, node: KnowledgeNode, projectPath: string, save: (operations: KnowledgeUpdateOperation[]) => Promise<void>): void {
  const mentionLinks = data.graph.links.filter((link) => link.relation === 'mentions' && (link.fromNodeId === node.id || link.toNodeId === node.id));
  const linked = new Set(mentionLinks.map((link) => link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId));
  const entities = data.graph.nodes
    .filter((entry) => entry.kind === 'person' || entry.kind === 'company')
    .sort((left, right) => {
      const leftSelected = linked.has(left.id);
      const rightSelected = linked.has(right.id);
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' });
    });
  const pathValue = textValue(node.data.path);
  const fields = Array.isArray(node.data.fields)
    ? node.data.fields.filter((field): field is { label: string; value: string } => Boolean(field) && typeof field === 'object' && typeof (field as { label?: unknown }).label === 'string' && typeof (field as { value?: unknown }).value === 'string')
    : [];
  const natures = ['assignation', 'conclusions', 'requête', 'courrier', 'courriel', 'mise en demeure', 'contrat', 'facture', 'devis', 'attestation', 'jugement', 'arrêt', 'ordonnance', 'procès-verbal', 'constat', 'expertise', 'statuts de société', 'extrait Kbis', 'relevé bancaire', 'acte notarié', 'bordereau de pièces'];
  const nature = textValue(node.data.nature);
  const natureOptions = [...new Set([nature, ...natures].filter(Boolean))]
    .map((value) => `<option value="${escapeHtml(value)}" ${value === nature ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  const entityButtons = entities.map((entry) => {
    const selected = linked.has(entry.id);
    return `<button class="pmd-document-entity${selected ? ' is-selected' : ''}" type="button" aria-pressed="${selected}" data-document-entity="${escapeHtml(entry.id)}">${selected ? '<span aria-hidden="true">✓</span>' : ''}${escapeHtml(entry.label)}</button>`;
  }).join('');
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
              <label class="pmd-document-wide">Type de pièce<select class="pmd-select" name="nature"><option value="">— Sélectionner —</option>${natureOptions}<option value="__piecemaker_custom_nature__">Autre type…</option></select></label>
              <label>Date<input class="pmd-input" type="date" name="date" value="${escapeHtml(dateFor(node))}"></label>
              <label>Lieu<input class="pmd-input" name="localisation" placeholder="Ex. TJ de ADRESSE_02" value="${escapeHtml(textValue(node.data.localisation))}"></label>
            </div>
            <div class="pmd-document-form-section"><span>Personnes citées</span><div class="pmd-document-entities">${entityButtons || '<p class="pmd-document-muted">Aucune personne connue.</p>'}</div></div>
            <div class="pmd-document-form-section"><div class="pmd-document-section-heading"><span>Champs libres</span><button class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" type="button" data-add-field>＋ Ajouter</button></div><div data-fields>${fieldRows}</div><p class="pmd-document-muted" data-empty-fields ${fields.length ? 'hidden' : ''}>Aucun champ libre.</p></div>
          </div>
          <div class="pmd-document-form-actions"><button class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" type="button" data-close>Annuler</button><button class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm" type="submit" data-document-submit>Enregistrer</button></div>
        </form>
      </div>
    </div>`);
  const preview = layer.querySelector<HTMLElement>('[data-document-preview]');
  const selectedEntities = new Set(linked);
  const datePreviewValues = (): string[] => {
    const iso = dateFor(node);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const numeric = match ? [`${match[3]}/${match[2]}/${match[1]}`, `${match[3]}-${match[2]}-${match[1]}`, `${match[3]}.${match[2]}.${match[1]}`] : [];
    return [textValue(node.data.doc_date), textValue(node.data.date), iso, ...numeric].filter(Boolean);
  };
  const mappedPreviewValues = (personMappings: boolean): string[] => {
    const kinds = new Map(data.graph.nodes.map((entry) => [entry.id, entry.kind]));
    return data.graph.mappings
      .filter((mapping) => {
        const kind = kinds.get(mapping.nodeId);
        return personMappings ? kind === 'person' || kind === 'company' : kind !== 'person' && kind !== 'company';
      })
      .flatMap((mapping) => [mapping.real, mapping.masked])
      .filter(Boolean);
  };
  const previewValues = (category: 'person' | 'date' | 'fact'): string[] => {
    if (category === 'person') return [...entities.flatMap((entry) => [entry.label, ...entry.aliases]), ...mappedPreviewValues(true)];
    if (category === 'date') return datePreviewValues();
    return [nature, textValue(node.data.localisation), ...fields.flatMap((field) => [field.label, field.value]), ...mappedPreviewValues(false)].filter(Boolean);
  };
  const highlightPreview = (content: string): string => {
    const categories: Array<'person' | 'date' | 'fact'> = ['person', 'date', 'fact'];
    const spans: Array<{ start: number; end: number; category: 'person' | 'date' | 'fact' }> = [];
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
      const className = span.category === 'person' ? 'pmd-highlight-person' : span.category === 'date' ? 'pmd-highlight-date' : 'pmd-highlight-fact';
      return `${escapeHtml(before)}<mark class="${className}">${escapeHtml(content.slice(span.start, span.end))}</mark>`;
    }).join('') + escapeHtml(content.slice(cursor));
  };
  const setPreviewError = (message: string) => {
    if (preview) preview.innerHTML = `<p class="pmd-document-muted">${escapeHtml(message)}</p>`;
  };
  const loadPreview = async () => {
    if (!pathValue) {
      setPreviewError('Cette pièce n’a pas de Markdown converti.');
      return;
    }
    try {
      const result = await knowledgeApi.document(projectPath, pathValue);
      if (preview) preview.innerHTML = `<pre>${highlightPreview(result.content)}</pre>`;
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  };
  const renderFields = () => {
    const fieldsTarget = layer.querySelector<HTMLElement>('[data-fields]');
    const empty = layer.querySelector<HTMLElement>('[data-empty-fields]');
    if (fieldsTarget && empty) empty.hidden = fieldsTarget.querySelectorAll('[data-field-row]').length > 0;
  };
  layer.querySelectorAll<HTMLElement>('[data-document-entity]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.documentEntity || '';
    if (!id) return;
    if (selectedEntities.has(id)) {
      selectedEntities.delete(id);
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
      button.querySelector('span')?.remove();
    } else {
      selectedEntities.add(id);
      button.classList.add('is-selected');
      button.setAttribute('aria-pressed', 'true');
      button.insertAdjacentHTML('afterbegin', '<span aria-hidden="true">✓</span>');
    }
  }));
  layer.querySelector<HTMLElement>('[data-add-field]')?.addEventListener('click', () => {
    const fieldsTarget = layer.querySelector<HTMLElement>('[data-fields]');
    if (!fieldsTarget) return;
    fieldsTarget.insertAdjacentHTML('beforeend', '<div class="pmd-document-field-row" data-field-row><input class="pmd-input" data-field-label placeholder="Libellé"><input class="pmd-input" data-field-value placeholder="Valeur"><button class="pmd-icon-button piecemaker-button piecemaker-button--icon" type="button" data-remove-field aria-label="Supprimer le champ">×</button></div>');
    layer.querySelector<HTMLInputElement>('[data-fields] [data-field-row]:last-child [data-field-label]')?.focus();
    renderFields();
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
    const customNature = natureSelection === '__piecemaker_custom_nature__' ? window.prompt('Type de pièce personnalisé :', '')?.trim() || '' : '';
    const savedNature = natureSelection === '__piecemaker_custom_nature__' ? customNature : natureSelection;
    const documentFields = Array.from(layer.querySelectorAll<HTMLElement>('[data-field-row]')).map((row) => ({ label: row.querySelector<HTMLInputElement>('[data-field-label]')?.value.trim() || '', value: row.querySelector<HTMLInputElement>('[data-field-value]')?.value.trim() || '' })).filter((field) => field.label || field.value);
    const operations: KnowledgeUpdateOperation[] = [{
      op: 'upsertNode',
      node: { id: node.id, kind: 'document', label: node.label, aliases: node.aliases, data: { ...node.data, nature: savedNature.trim() || null, doc_date_iso: textValue(form.get('date')) || null, localisation: textValue(form.get('localisation')).trim() || null, fields: documentFields }, origin: 'manual' },
    }];
    for (const link of mentionLinks) operations.push({ op: 'unlink', link: { fromNodeId: link.fromNodeId, toNodeId: link.toNodeId, relation: link.relation } });
    for (const target of selectedEntities) operations.push({ op: 'link', link: { fromNodeId: node.id, toNodeId: target, relation: 'mentions', origin: 'manual' } });
    try {
      await save(operations);
      layer.remove();
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Enregistrer';
      }
    }
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
    pills.querySelectorAll<HTMLButtonElement>('[data-remove-term]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.removeTerm);
      const term = terms[index];
      if (!window.confirm(`Supprimer le terme « ${term} » de la liste institutionnelle ?`)) return;
      terms.splice(index, 1);
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
