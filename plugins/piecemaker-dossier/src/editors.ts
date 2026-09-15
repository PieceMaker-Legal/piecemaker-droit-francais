import { entityKinds, escapeHtml, labels, textValue, dateFor } from './views.js';
import { knowledgeApi } from './api.js';
import type { ViewData } from './views.js';
import type { KnowledgeNode, KnowledgeUpdateOperation, NodeKind } from './types.js';

export function modal(root: HTMLElement, body: string): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pmd-modal';
  layer.innerHTML = `<div class="pmd-dialog">${body}</div>`;
  root.appendChild(layer);
  layer.addEventListener('click', (event) => { if (event.target === layer) layer.remove(); });
  layer.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => layer.remove()));
  return layer;
}

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

export type PartyEditorDefaults = {
  kind?: 'person' | 'company';
  partySide?: 'client' | 'adversaire';
};

export function partyTypePicker(root: HTMLElement, side: 'client' | 'adversaire', onSelect: (kind: 'person' | 'company') => void): HTMLElement {
  const sideLabel = side === 'client' ? 'cliente' : 'adverse';
  const layer = modal(root, `
    <div class="pmd-party-picker">
      <div class="pmd-toolbar"><div><h2 class="pmd-title">Ajouter une partie ${sideLabel}</h2><div class="pmd-subtitle">Choisissez le type de partie à créer</div></div><span class="pmd-spacer"></span><button class="pmd-icon-button" data-close aria-label="Fermer">×</button></div>
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
  const mappings = node ? data.graph.mappings.filter((entry) => entry.nodeId === node.id) : [];
  const relations = node ? data.graph.links.filter((entry) => entry.fromNodeId === node.id || entry.toNodeId === node.id) : [];
  const sirenNodes = data.graph.nodes.filter((entry) => entry.kind === 'siren');
  const linkedSiren = node ? relations.find((entry) => entry.relation.toLocaleLowerCase() === 'siren' && entry.fromNodeId === node.id && sirenNodes.some((candidate) => candidate.id === entry.toNodeId)) : undefined;
  const linkedSirenNode = linkedSiren ? sirenNodes.find((entry) => entry.id === linkedSiren.toNodeId) : undefined;
  const companyFieldsHidden = selectedKind !== 'company';
  const initialAliases = [...new Set((node?.aliases || []).map((alias) => alias.trim()).filter(Boolean))];
  const layer = modal(root, `
    <div class="pmd-toolbar"><h2 class="pmd-title">${node ? 'Modifier l’élément' : 'Ajouter un élément'}</h2><span class="pmd-spacer"></span><button class="pmd-icon-button" data-close>×</button></div>
    <form class="pmd-form" data-node-form>
      <label>Type<select class="pmd-select" name="kind">${kindOptions(node?.kind || defaults.kind || 'person')}</select></label>
      <label>Libellé<input class="pmd-input" name="label" value="${escapeHtml(node?.label || '')}" required></label>
      <label>Variantes<div class="pmd-alias-editor" data-alias-editor><div class="pmd-alias-pills" data-alias-pills></div><input class="pmd-input pmd-alias-input" data-alias-input placeholder="Saisissez une variante puis appuyez sur Entrée"><input type="hidden" name="aliases"></div></label>
      <label>Code anonymisé<input class="pmd-input" name="masked" value="${escapeHtml(mappings[0]?.masked || '')}"></label>
      <label>Statut procédural<select class="pmd-select" name="partySide"><option value="">Aucun</option><option value="client" ${(!node && defaults.partySide === 'client') || (node && node.data.partySide === 'client') || (!node && !defaults.partySide) ? 'selected' : ''}>Partie cliente</option><option value="adversaire" ${(node && node.data.partySide === 'adversaire') || (!node && defaults.partySide === 'adversaire') ? 'selected' : ''}>Partie adverse</option></select></label>
      <div data-company-fields ${companyFieldsHidden ? 'hidden' : ''}>
        <label>Forme sociale<input class="pmd-input" name="legalForm" value="${escapeHtml(textValue(node?.data.legalForm))}"></label>
        <label>Numéro SIREN<input class="pmd-input" name="siren" inputmode="numeric" autocomplete="off" value="${escapeHtml(linkedSirenNode?.label || '')}" placeholder="9 chiffres"><div class="pmd-siren-suggestions" data-siren-suggestions></div></label>
      </div>
      <label>Nouvelle relation<select class="pmd-select" name="target"><option value="">Aucune</option>${data.graph.nodes.filter((entry) => entry.id !== id && entry.kind !== 'document').map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`).join('')}</select></label>
      <label>Type de relation<select class="pmd-select" name="relation">${relationSelectOptions()}</select></label>
      <label data-custom-relation hidden>Relation personnalisée<input class="pmd-input" name="customRelation" placeholder="Saisissez une relation"></label>
      ${relations.length ? `<div><div class="pmd-group">Relations actuelles</div><div class="pmd-badges">${relations.map((relation, index) => `<button type="button" class="pmd-badge pmd-icon-button" data-unlink="${index}">${escapeHtml(relation.relation)} ×</button>`).join('')}</div></div>` : ''}
      <div class="pmd-form-actions"><button type="button" class="pmd-button" data-close>Annuler</button><button class="pmd-button pmd-button-primary">Enregistrer</button></div>
    </form>`);
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
  kindSelect?.addEventListener('change', () => {
    if (!companyFields || !kindSelect) return;
    companyFields.hidden = kindSelect.value !== 'company';
    if (kindSelect.value === 'company') renderSirenSuggestions();
  });
  sirenInput?.addEventListener('input', renderSirenSuggestions);
  sirenInput?.addEventListener('focus', renderSirenSuggestions);
  renderSirenSuggestions();
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
    const operations: KnowledgeUpdateOperation[] = [{ op: 'upsertNode', node: { id, kind, label, aliases: savedAliases, data: { ...(node?.data || {}), partySide: partySide || null, legalForm: legalForm || null }, origin: 'manual' } }];
    for (const mapping of mappings) operations.push({ op: 'deleteMapping', mapping: { nodeId: id, real: mapping.real } });
    for (const real of [label, ...savedAliases]) if (masked) operations.push({ op: 'upsertMapping', mapping: { nodeId: id, real, masked, origin: 'manual' } });
    for (const index of removals) {
      const relation = relations[index];
      operations.push({ op: 'unlink', link: { fromNodeId: relation.fromNodeId, toNodeId: relation.toNodeId, relation: relation.relation } });
    }
    const target = textValue(form.get('target'));
    const selectedRelation = textValue(form.get('relation')).trim();
    const customRelation = textValue(form.get('customRelation')).trim();
    const relation = selectedRelation === '__custom__' ? customRelation : selectedRelation;
    if (selectedRelation === '__custom__' && customRelation) customRelationOptions.add(customRelation);
    if (target && relation) operations.push({ op: 'link', link: { fromNodeId: id, toNodeId: target, relation, origin: 'manual' } });
    if (sirenNode && !data.graph.links.some((link) => link.fromNodeId === id && link.toNodeId === sirenNode.id && link.relation.toLocaleLowerCase() === 'siren')) operations.push({ op: 'link', link: { fromNodeId: id, toNodeId: sirenNode.id, relation: 'SIREN', origin: 'manual' } });
    await save(operations);
    layer.remove();
  });
}

export function documentEditor(root: HTMLElement, data: ViewData, node: KnowledgeNode, save: (operations: KnowledgeUpdateOperation[]) => Promise<void>): void {
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
  const fieldRows = fields.map((field, index) => `<div class="pmd-document-field-row" data-field-row><input class="pmd-input" data-field-label value="${escapeHtml(field.label)}" placeholder="Libellé"><input class="pmd-input" data-field-value value="${escapeHtml(field.value)}" placeholder="Valeur"><button class="pmd-icon-button" type="button" data-remove-field="${index}" aria-label="Supprimer le champ">×</button></div>`).join('');
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
            <div class="pmd-document-form-section"><div class="pmd-document-section-heading"><span>Champs libres</span><button class="pmd-button" type="button" data-add-field>＋ Ajouter</button></div><div data-fields>${fieldRows}</div><p class="pmd-document-muted" data-empty-fields ${fields.length ? 'hidden' : ''}>Aucun champ libre.</p></div>
          </div>
          <div class="pmd-document-form-actions"><button class="pmd-button" type="button" data-close>Annuler</button><button class="pmd-button pmd-button-primary">Enregistrer</button></div>
        </form>
      </div>
    </div>`);
  const preview = layer.querySelector<HTMLElement>('[data-document-preview]');
  const selectedEntities = new Set(linked);
  const previewValues = (category: 'person' | 'date' | 'fact'): string[] => {
    if (category === 'person') return entities.map((entry) => entry.label);
    if (category === 'date') return [dateFor(node), textValue(node.data.date)].filter(Boolean);
    return [nature, textValue(node.data.localisation), ...fields.flatMap((field) => [field.label, field.value])].filter(Boolean);
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
      const result = await knowledgeApi.document(data.graph.projectId, pathValue);
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
    fieldsTarget.insertAdjacentHTML('beforeend', '<div class="pmd-document-field-row" data-field-row><input class="pmd-input" data-field-label placeholder="Libellé"><input class="pmd-input" data-field-value placeholder="Valeur"><button class="pmd-icon-button" type="button" data-remove-field aria-label="Supprimer le champ">×</button></div>');
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
    }
  });
  void loadPreview();
}
