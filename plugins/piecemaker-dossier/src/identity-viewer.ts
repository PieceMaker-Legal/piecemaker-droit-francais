import { knowledgeApi } from './api.js';
import type { CaseSummary } from './api.js';
import { askConfirm, askPrompt, nodeEditor } from './editors.js';
import { nodeCode } from './party-codes.js';
import { cleanSelection, createEntity } from './selection-categories.js';
import type { SelectionSide } from './selection-categories.js';
import { PLUGIN_STYLES } from './styles.js';
import { escapeHtml, kindLabels, nodeVariants } from './views.js';
import type { KnowledgeNode, KnowledgeSnapshot, KnowledgeUpdateOperation } from './types.js';

type Tab = 'fiche' | 'mapping';
type Focus = { projectId: string; nodeId: string; word: string };
type MappingRow = { projectId: string; node: KnowledgeNode; real: string; masked: string };

const OPEN_EVENT = 'piecemaker:identity-open';
const ADD_EVENT = 'piecemaker:identity-add';
const CHANGED_EVENT = 'piecemaker:identity-changed';
const OPEN_CLASS = 'pmd-identity-open';

const moreIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';

const IDENTITY_STYLES = `
.pmd-identity{position:fixed;inset:0 0 0 auto;width:min(44vw,720px);z-index:46;border-left:1px solid var(--pmd-border);box-shadow:-12px 0 32px rgb(15 23 42 / .08)}
@media (min-width:1024px){.${OPEN_CLASS} #root{width:calc(100% - min(44vw,720px))}}
@media (max-width:1023px){.pmd-identity{width:min(100vw,600px);z-index:70}}
.pmd-identity-header{display:flex;flex-shrink:0;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--pmd-border)}
.pmd-identity-context{display:flex;flex-shrink:0;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--pmd-border);color:var(--pmd-muted);font-size:12px}
.pmd-identity-context strong{color:var(--pmd-ink);font-weight:600}
.pmd-identity-context .pmd-select{width:auto;height:28px;padding:2px 8px;font-size:12px}
.pmd-identity-body{position:relative;flex:1;min-height:0;overflow:auto;padding:16px}
.pmd-identity-body>.pmd-modal:not(:has(.pmd-dialog-compact)){position:static;display:block;padding:0;background:none}
.pmd-identity-body>.pmd-modal>.pmd-dialog:not(.pmd-dialog-compact){width:auto;max-height:none;overflow:visible;border:0;border-radius:0;padding:0;box-shadow:none;background:transparent}
.pmd-identity-body .pmd-dialog-columns{flex-direction:column}
.pmd-identity-body .pmd-toolbar>[data-close]{display:none}
.pmd-identity-filters{display:flex;gap:8px;margin-bottom:10px}
.pmd-identity-filters>*{flex:1;min-width:0}
.pmd-identity-count{margin:0 0 10px;color:var(--pmd-muted);font-size:12px}
.pmd-identity-legend,.pmd-identity-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) minmax(0,.9fr) 28px;gap:8px;align-items:center}
.pmd-identity-legend{padding:0 10px 6px;color:var(--pmd-muted);font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.pmd-identity-rows{display:grid;gap:6px}
.pmd-identity-row{border:1px solid var(--pmd-border);border-radius:10px;background:var(--pmd-surface);padding:7px 10px;font-size:12px}
.pmd-identity-row[hidden]{display:none}
.pmd-identity-row[data-current=true]{border-color:rgb(234 179 8 / .7);background:rgb(234 179 8 / .16)}
.pmd-identity-row code{overflow-wrap:anywhere;color:var(--pmd-ink);font:11px ui-monospace,SFMono-Regular,Menlo,monospace}
.pmd-identity-real{overflow-wrap:anywhere;color:var(--pmd-ink)}
.pmd-identity-real small{display:block;color:var(--pmd-muted)}
.pmd-identity-case{overflow-wrap:anywhere;color:var(--pmd-muted)}
.pmd-identity-row .pmd-profile-menu-wrap{margin-left:0}
.pmd-identity-row .pmd-profile-menu[data-drop=up]{top:auto;bottom:32px}
.pmd-identity-choice{display:grid;gap:10px;margin:0;border:0;padding:0}
.pmd-identity-choice>div{display:grid;gap:10px;padding-left:24px}
`;

export const fold = (value: string): string => cleanSelection(value).toLocaleLowerCase('fr-FR');

export function locateWord(word: string, graphs: Map<string, KnowledgeSnapshot>): Focus[] {
  const key = fold(word);
  const found: Focus[] = [];
  if (!key) return found;
  for (const [projectId, graph] of graphs) {
    for (const mapping of graph.mappings) {
      const real = fold(mapping.real) === key;
      if (!real && fold(mapping.masked) !== key) continue;
      if (found.some((entry) => entry.projectId === projectId && entry.nodeId === mapping.nodeId)) continue;
      found.push({ projectId, nodeId: mapping.nodeId, word: real ? mapping.real : graph.nodes.find((node) => node.id === mapping.nodeId)?.label || mapping.real });
    }
  }
  return found;
}

export function mappingRows(graphs: Map<string, KnowledgeSnapshot>, cases: CaseSummary[]): MappingRow[] {
  const order = new Map(cases.map((entry, index) => [entry.projectId, index]));
  const rows: MappingRow[] = [];
  for (const [projectId, graph] of graphs) {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const mapping of graph.mappings) {
      const node = nodes.get(mapping.nodeId);
      if (node && node.kind !== 'document') rows.push({ projectId, node, real: mapping.real, masked: mapping.masked });
    }
  }
  return rows.sort((left, right) => (order.get(left.projectId) ?? 0) - (order.get(right.projectId) ?? 0)
    || left.masked.localeCompare(right.masked)
    || left.real.localeCompare(right.real));
}

export function variantOperations(node: KnowledgeNode, graph: KnowledgeSnapshot, word: string): KnowledgeUpdateOperation[] {
  const code = graph.mappings.find((mapping) => mapping.nodeId === node.id)?.masked || nodeCode(node);
  if (!code) throw new Error('Cette entité n’a pas de code anonymisé.');
  const value = cleanSelection(word);
  return [
    { op: 'upsertNode', node: { id: node.id, kind: node.kind, label: node.label, aliases: [...new Set([...node.aliases, value])].filter((alias) => alias !== node.label), data: node.data } },
    { op: 'upsertMapping', mapping: { nodeId: node.id, real: value, masked: code } },
  ];
}

export function writingRemovalOperations(node: KnowledgeNode, graph: KnowledgeSnapshot, real: string): KnowledgeUpdateOperation[] {
  const remaining = [node.label, ...nodeVariants(node, graph.mappings)].filter((value) => value.trim() && value !== real);
  if (!remaining.length) return [{ op: 'deleteNode', nodeId: node.id }];
  const label = node.label === real ? remaining[0] : node.label;
  return [
    { op: 'upsertNode', node: { id: node.id, kind: node.kind, label, aliases: node.aliases.filter((alias) => alias !== real && alias !== label), data: node.data } },
    { op: 'deleteMapping', mapping: { nodeId: node.id, real } },
    { op: 'excludeAlias', exclusion: { entite: node.id, alias: real } },
  ];
}

export function inject(): () => void {
  const style = document.createElement('style');
  style.textContent = PLUGIN_STYLES + IDENTITY_STYLES;
  document.head.appendChild(style);

  let panel: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  let tab: Tab = 'fiche';
  let cases: CaseSummary[] = [];
  const graphs = new Map<string, KnowledgeSnapshot>();
  let focus: Focus | null = null;
  let matches: Focus[] = [];
  let adding: string | null = null;
  let lastAddCase = '';
  let filterText = '';
  let filterCase = '';
  let error = '';
  let loading = false;
  let sequence = 0;
  let rows: MappingRow[] = [];
  let editorObserver: MutationObserver | null = null;
  const themeObserver = new MutationObserver(() => { if (panel) panel.dataset.theme = theme(); });

  const theme = () => document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const caseName = (projectId: string) => cases.find((entry) => entry.projectId === projectId)?.name || projectId;

  const loadCase = async (projectId: string) => {
    graphs.set(projectId, await knowledgeApi.graph(projectId));
  };

  const loadAll = async () => {
    const current = ++sequence;
    loading = true;
    render();
    try {
      cases = (await knowledgeApi.projects()).projects;
      graphs.clear();
      await Promise.all(cases.filter((entry) => entry.mappings > 0).map((entry) => loadCase(entry.projectId)));
      error = '';
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    if (current !== sequence) return false;
    loading = false;
    return true;
  };

  const refocus = () => {
    if (!focus) return;
    const graph = graphs.get(focus.projectId);
    if (graph?.nodes.some((node) => node.id === focus?.nodeId)) return;
    const moved = locateWord(focus.word, graphs).find((entry) => entry.projectId === focus?.projectId);
    focus = moved || null;
  };

  const save = async (projectId: string, operations: KnowledgeUpdateOperation[]) => {
    try {
      await knowledgeApi.update(projectId, operations);
      error = '';
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    await loadCase(projectId).catch(() => undefined);
    refocus();
    window.dispatchEvent(new Event(CHANGED_EVENT));
  };

  const close = () => {
    sequence += 1;
    editorObserver?.disconnect();
    editorObserver = null;
    panel?.remove();
    panel = null;
    body = null;
    document.documentElement.classList.remove(OPEN_CLASS);
  };

  const ensurePanel = () => {
    if (panel) return;
    panel = document.createElement('aside');
    panel.className = 'pmd-root piecemaker-ui pmd-identity';
    panel.setAttribute('aria-label', 'Pseudonymisation');
    panel.innerHTML = `<header class="pmd-identity-header"><div class="pmd-tabs" role="tablist"><button type="button" class="pmd-tab piecemaker-button piecemaker-button--sm" role="tab" data-identity-tab="fiche">Fiche</button><button type="button" class="pmd-tab piecemaker-button piecemaker-button--sm" role="tab" data-identity-tab="mapping">Mapping</button></div><span class="pmd-spacer"></span><button type="button" class="pmd-icon-button piecemaker-button piecemaker-button--icon" data-identity-close aria-label="Fermer la visionneuse">×</button></header><div class="pmd-identity-context" data-identity-context></div><div data-identity-error></div><div class="pmd-identity-body" data-identity-body></div>`;
    document.body.appendChild(panel);
    document.documentElement.classList.add(OPEN_CLASS);
    body = panel.querySelector<HTMLElement>('[data-identity-body]');
    panel.querySelector('[data-identity-close]')?.addEventListener('click', close);
    panel.querySelectorAll<HTMLElement>('[data-identity-tab]').forEach((button) => button.addEventListener('click', () => {
      const next = button.dataset.identityTab as Tab;
      if (next === 'mapping' && tab !== 'mapping') {
        filterText = '';
        filterCase = '';
      }
      tab = next;
      render();
    }));
    editorObserver = new MutationObserver((records) => {
      const editorClosed = records.some((record) => Array.from(record.removedNodes).some((node) => node instanceof HTMLElement && node.classList.contains('pmd-modal')));
      if (editorClosed && tab === 'fiche' && adding === null && body && !body.querySelector('.pmd-modal') && !loading) renderFiche();
    });
    body?.addEventListener('click', (event) => {
      if (tab !== 'mapping' || !body) return;
      const target = event.target as HTMLElement;
      const closeMenus = (except?: HTMLElement | null) => body?.querySelectorAll<HTMLElement>('.pmd-profile-menu[data-open=true]').forEach((menu) => { if (menu !== except) menu.dataset.open = 'false'; });
      const trigger = target.closest<HTMLElement>('[data-row-menu]');
      if (trigger) {
        const menu = trigger.parentElement?.querySelector<HTMLElement>('.pmd-profile-menu') || null;
        closeMenus(menu);
        if (!menu) return;
        menu.dataset.drop = body.getBoundingClientRect().bottom - trigger.getBoundingClientRect().bottom < 170 ? 'up' : 'down';
        menu.dataset.open = menu.dataset.open === 'true' ? 'false' : 'true';
        return;
      }
      closeMenus();
      const action = target.closest<HTMLElement>('[data-row-action]')?.dataset.rowAction;
      const row = rows[Number(target.closest<HTMLElement>('[data-row]')?.dataset.row)];
      if (action && row) void rowAction(action, row);
    });
    if (body) editorObserver.observe(body, { childList: true });
  };

  const paintHeader = () => {
    if (!panel) return;
    panel.dataset.theme = theme();
    panel.querySelectorAll<HTMLElement>('[data-identity-tab]').forEach((button) => {
      const selected = button.dataset.identityTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    const context = panel.querySelector<HTMLElement>('[data-identity-context]');
    if (context) {
      if (adding !== null) context.innerHTML = '<span>Nouveau pseudonyme</span>';
      else if (focus) {
        const caseChoice = matches.length > 1
          ? `<select class="pmd-select" data-identity-match aria-label="Dossier">${matches.map((entry, index) => `<option value="${index}" ${entry.projectId === focus?.projectId && entry.nodeId === focus?.nodeId ? 'selected' : ''}>${escapeHtml(caseName(entry.projectId))}</option>`).join('')}</select>`
          : `<strong>${escapeHtml(caseName(focus.projectId))}</strong>`;
        context.innerHTML = `<span>« ${escapeHtml(focus.word)} »</span><span>Dossier :</span>${caseChoice}`;
        context.querySelector<HTMLSelectElement>('[data-identity-match]')?.addEventListener('change', (event) => {
          focus = matches[Number((event.target as HTMLSelectElement).value)] || focus;
          render();
        });
      } else context.innerHTML = '<span>Tous les pseudonymes</span>';
    }
    const errorSlot = panel.querySelector<HTMLElement>('[data-identity-error]');
    if (errorSlot) errorSlot.innerHTML = error ? `<div class="pmd-error">${escapeHtml(error)}</div>` : '';
  };

  const renderFiche = () => {
    if (!body) return;
    if (adding !== null) {
      renderAddForm();
      return;
    }
    const current = focus;
    const graph = current ? graphs.get(current.projectId) : undefined;
    const node = current && graph?.nodes.find((entry) => entry.id === current.nodeId);
    if (!current || !graph || !node) {
      body.innerHTML = `<div class="pmd-empty">${current ? 'Ce pseudonyme n’existe plus dans le mapping.' : 'Aucun pseudonyme sélectionné.'}</div>`;
      return;
    }
    body.replaceChildren();
    nodeEditor(body, { graph }, node, (operations) => save(current.projectId, operations), {}, () => {
      tab = 'mapping';
      filterText = '';
      filterCase = '';
      render();
    });
  };

  const renderAddForm = () => {
    if (!body) return;
    const word = adding || '';
    const projectId = cases.some((entry) => entry.projectId === lastAddCase) ? lastAddCase : cases.find((entry) => entry.mappings > 0)?.projectId || cases[0]?.projectId || '';
    body.innerHTML = `<form class="pmd-form" data-identity-add>
      <h2 class="pmd-title piecemaker-display">Ajouter au mapping</h2>
      <label>Mot ou expression<input class="pmd-input" name="word" value="${escapeHtml(word)}" required></label>
      <label>Dossier<select class="pmd-select" name="projectId">${cases.map((entry) => `<option value="${escapeHtml(entry.projectId)}" ${entry.projectId === projectId ? 'selected' : ''}>${escapeHtml(entry.name)}</option>`).join('')}</select></label>
      <fieldset class="pmd-identity-choice">
        <label class="pmd-confirm-option"><input type="radio" name="mode" value="new" checked><span>Nouvelle entité</span></label>
        <div data-new-fields>
          <label>Type<select class="pmd-select" name="kind"><option value="person">${kindLabels.person}</option><option value="company">${kindLabels.company}</option></select></label>
          <label>Partie<select class="pmd-select" name="side"><option value="tiers">Tiers</option><option value="client">Partie cliente</option><option value="adversaire">Partie adverse</option></select></label>
        </div>
        <label class="pmd-confirm-option"><input type="radio" name="mode" value="variant"><span>Autre écriture d’une entité existante</span></label>
        <div data-variant-fields hidden><label>Entité<select class="pmd-select" name="nodeId"></select></label></div>
      </fieldset>
      <div class="pmd-form-actions"><button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-identity-cancel>Annuler</button><button class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm">Ajouter</button></div>
    </form>`;
    const form = body.querySelector<HTMLFormElement>('[data-identity-add]');
    if (!form) return;
    const caseSelect = form.querySelector<HTMLSelectElement>('select[name="projectId"]');
    const nodeSelect = form.querySelector<HTMLSelectElement>('select[name="nodeId"]');
    const newFields = form.querySelector<HTMLElement>('[data-new-fields]');
    const variantFields = form.querySelector<HTMLElement>('[data-variant-fields]');
    const fillEntities = async () => {
      const selected = caseSelect?.value || '';
      if (selected && !graphs.has(selected)) await loadCase(selected).catch(() => undefined);
      const entities = (graphs.get(selected)?.nodes || []).filter((node) => node.kind !== 'document');
      if (nodeSelect) nodeSelect.innerHTML = entities.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.label)} · ${escapeHtml(kindLabels[node.kind])}</option>`).join('') || '<option value="">Aucune entité dans ce dossier</option>';
    };
    caseSelect?.addEventListener('change', () => void fillEntities());
    form.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => radio.addEventListener('change', () => {
      const variant = form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value === 'variant';
      if (newFields) newFields.hidden = variant;
      if (variantFields) variantFields.hidden = !variant;
    }));
    form.querySelector('[data-identity-cancel]')?.addEventListener('click', close);
    void fillEntities();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const value = cleanSelection(String(data.get('word') || ''));
      const target = String(data.get('projectId') || '');
      if (!value || !target) return;
      if (!graphs.has(target)) await loadCase(target).catch(() => undefined);
      const graph = graphs.get(target);
      if (!graph) return;
      lastAddCase = target;
      try {
        let nodeId = '';
        let operations: KnowledgeUpdateOperation[] = [];
        if (data.get('mode') === 'variant') {
          const node = graph.nodes.find((entry) => entry.id === data.get('nodeId'));
          if (!node) throw new Error('Choisissez une entité.');
          nodeId = node.id;
          operations = variantOperations(node, graph, value);
        } else {
          const change = createEntity(value, data.get('kind') === 'company' ? 'company' : 'person', String(data.get('side') || 'tiers') as SelectionSide, graph);
          nodeId = change.nodeId;
          operations = change.operations;
        }
        adding = null;
        focus = { projectId: target, nodeId, word: value };
        matches = [focus];
        await save(target, operations);
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
      render();
    });
  };

  const renderMapping = () => {
    if (!body) return;
    rows = mappingRows(graphs, cases);
    const mappedCases = cases.filter((entry) => graphs.has(entry.projectId));
    body.innerHTML = `<div class="pmd-identity-filters"><input class="pmd-input" type="search" data-filter-text placeholder="Rechercher un nom ou un code" value="${escapeHtml(filterText)}"><select class="pmd-select" data-filter-case aria-label="Filtrer par dossier"><option value="">Tous les dossiers</option>${mappedCases.map((entry) => `<option value="${escapeHtml(entry.projectId)}" ${entry.projectId === filterCase ? 'selected' : ''}>${escapeHtml(entry.name)}</option>`).join('')}</select></div>
      <p class="pmd-identity-count" data-identity-count></p>
      <div class="pmd-identity-legend"><span>Code</span><span>Écriture</span><span>Dossier</span><span></span></div>
      <div class="pmd-identity-rows">${rows.map((row, index) => {
        const current = Boolean(focus && focus.projectId === row.projectId && focus.nodeId === row.node.id && fold(focus.word) === fold(row.real));
        const search = fold(`${row.masked} ${row.real} ${row.node.label}`);
        return `<div class="pmd-identity-row" data-row="${index}" data-case="${escapeHtml(row.projectId)}" data-search="${escapeHtml(search)}" data-current="${current}"><code>${escapeHtml(row.masked)}</code><span class="pmd-identity-real">${escapeHtml(row.real)}${row.real !== row.node.label ? `<small>${escapeHtml(row.node.label)}</small>` : ''}</span><span class="pmd-identity-case">${escapeHtml(caseName(row.projectId))}</span><div class="pmd-profile-menu-wrap"><button type="button" class="pmd-profile-menu-trigger" data-row-menu aria-label="Options pour ${escapeHtml(row.real)}">${moreIcon}</button><div class="pmd-profile-menu"><button type="button" data-row-action="edit">Modifier la fiche</button><button type="button" data-row-action="variant">Ajouter une écriture</button><button type="button" data-row-action="exclude">Ajouter aux exclusions</button><button type="button" class="pmd-menu-danger" data-row-action="delete">Supprimer</button></div></div></div>`;
      }).join('') || '<div class="pmd-empty">Aucun pseudonyme.</div>'}</div>`;
    const applyFilters = () => {
      const key = fold(filterText);
      let visible = 0;
      body?.querySelectorAll<HTMLElement>('[data-row]').forEach((element) => {
        const shown = (!filterCase || element.dataset.case === filterCase) && (!key || (element.dataset.search || '').includes(key));
        element.hidden = !shown;
        if (shown) visible += 1;
      });
      const count = body?.querySelector<HTMLElement>('[data-identity-count]');
      if (count) count.textContent = `${visible} écriture${visible > 1 ? 's' : ''} pseudonymisée${visible > 1 ? 's' : ''}`;
    };
    body.querySelector<HTMLInputElement>('[data-filter-text]')?.addEventListener('input', (event) => {
      filterText = (event.target as HTMLInputElement).value;
      applyFilters();
    });
    body.querySelector<HTMLSelectElement>('[data-filter-case]')?.addEventListener('change', (event) => {
      filterCase = (event.target as HTMLSelectElement).value;
      applyFilters();
    });
    applyFilters();
    const current = body.querySelector<HTMLElement>('[data-current=true]:not([hidden])');
    current?.scrollIntoView?.({ block: 'center' });
  };

  const rowAction = async (action: string, row: MappingRow) => {
    const graph = graphs.get(row.projectId);
    if (!graph || !panel) return;
    if (action === 'edit') {
      focus = { projectId: row.projectId, nodeId: row.node.id, word: row.real };
      matches = locateWord(row.real, graphs);
      tab = 'fiche';
      render();
      return;
    }
    if (action === 'variant') {
      const value = await askPrompt(panel, `Autre écriture de « ${row.node.label} »`, '', 'Ajouter');
      if (!value?.trim()) return;
      focus = { projectId: row.projectId, nodeId: row.node.id, word: cleanSelection(value) };
      await save(row.projectId, variantOperations(row.node, graph, value));
    } else if (action === 'delete') {
      const operations = writingRemovalOperations(row.node, graph, row.real);
      const whole = operations[0]?.op === 'deleteNode';
      if (!await askConfirm(panel, whole ? `Supprimer « ${row.node.label} » et ses relations ?` : `Retirer l’écriture « ${row.real} » ?`, 'Supprimer')) return;
      await save(row.projectId, operations);
    } else if (action === 'exclude') {
      if (!await askConfirm(panel, `Ne plus jamais pseudonymiser « ${row.real} », dans tous les dossiers ?`, 'Exclure')) return;
      const key = fold(row.real);
      const affected = [...graphs].filter(([, entry]) => entry.mappings.some((mapping) => fold(mapping.real) === key)
        || entry.nodes.some((node) => [node.label, ...node.aliases].some((value) => fold(value) === key))).map(([projectId]) => projectId);
      try {
        const { terms } = await knowledgeApi.institutionalTerms();
        await knowledgeApi.saveInstitutionalTerms([...terms, row.real]);
        for (const projectId of affected) await save(projectId, []);
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
    }
    render();
  };

  const render = () => {
    if (!panel || !body) return;
    paintHeader();
    if (loading) {
      body.innerHTML = '<div class="pmd-empty">Chargement…</div>';
      return;
    }
    if (tab === 'mapping') renderMapping();
    else renderFiche();
  };

  const open = async (text: string, add: boolean) => {
    ensurePanel();
    tab = 'fiche';
    focus = null;
    matches = [];
    adding = null;
    error = '';
    if (!await loadAll()) return;
    matches = locateWord(text, graphs);
    if (matches.length) focus = matches[0];
    else if (add) adding = cleanSelection(text);
    render();
  };

  const onOpen = (event: Event) => {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
    if (typeof text === 'string' && text.trim()) void open(text, false);
  };
  const onAdd = (event: Event) => {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
    if (typeof text === 'string' && text.trim()) void open(text, true);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !panel || panel.querySelector('.pmd-dialog-compact')) return;
    close();
  };

  window.addEventListener(OPEN_EVENT, onOpen);
  window.addEventListener(ADD_EVENT, onAdd);
  document.addEventListener('keydown', onKey);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  return () => {
    window.removeEventListener(OPEN_EVENT, onOpen);
    window.removeEventListener(ADD_EVENT, onAdd);
    document.removeEventListener('keydown', onKey);
    themeObserver.disconnect();
    close();
    style.remove();
  };
}
