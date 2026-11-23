import { editClassification } from './classification.js';
import { modal } from './editors.js';
import { okfApi, type LofEntry } from './okf.js';
import { askChat, chatAttributes } from './chat-pick.js';
import { escapeHtml } from './views.js';

const ASK_NOTE = 'ontologie LOF reprise du dépôt Legal Ontologies Foundry, lue par pm okf ontologie ; elle ne se modifie pas';
const KINDS: Array<[LofEntry['kind'], string]> = [['class', 'Classes'], ['objprop', 'Object properties'], ['dataprop', 'Data properties'], ['individual', 'Individuals']];

function termMarkup(term: LofEntry, labelOf: (id: string) => string): string {
  const list = (name: string, ids?: string[]) => ids?.length ? `<dt>${name}</dt><dd>${ids.map((id) => escapeHtml(labelOf(id))).join(', ')}</dd>` : '';
  const notes = term.annotations.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
  const axioms = (term.axioms || []).map((axiom) => `<dt>${escapeHtml(axiom.k)}</dt><dd>${escapeHtml(axiom.m)}</dd>`).join('');
  return `<details class="pmd-form-section pmd-ontology-row" data-lof-term="${escapeHtml(term.id)}"${chatAttributes(term.label, 'LOF', ASK_NOTE, {})}>
    <summary><strong>${escapeHtml(term.label)}</strong> <code>${escapeHtml(term.id)}</code></summary>
    <dl class="pmd-fact-props"><dt>IRI</dt><dd>${escapeHtml(term.iri)}</dd>${notes}${list('subClassOf', term.subClassOf)}${list('subPropertyOf', term.subPropertyOf)}${list('domain', term.domain)}${list('range', term.range)}${list('inverseOf', term.inverseOf)}${list('type', term.type)}${axioms}</dl>
  </details>`;
}

async function showLof(root: HTMLElement, projectId: string): Promise<() => Promise<void>> {
  const state = await okfApi.ontology(projectId);
  const labels = new Map(state.lof.map((term) => [term.id, term.label]));
  const labelOf = (id: string) => labels.get(id) || id;
  const layer = modal(root, `
    <div class="pmd-form" data-lof-view>
      <div class="pmd-ontology-change-head"><h2 class="pmd-title piecemaker-display">Legal Ontologies Foundry</h2><span class="pmd-spacer"></span><button type="button" class="pmd-button" data-lof-ask>Demander à l’assistant</button></div>
      <p class="pmd-form-note">${escapeHtml(state.attribution)} <a href="${escapeHtml(state.source)}" target="_blank" rel="noreferrer">${escapeHtml(state.source)}</a></p>
      ${state.erreur ? `<div class="pmd-error" role="alert">${escapeHtml(state.erreur)}</div>` : ''}
      ${KINDS.map(([kind, title]) => {
        const terms = state.lof.filter((term) => term.kind === kind);
        return terms.length ? `<h3>${title} (${terms.length})</h3>${terms.map((term) => termMarkup(term, labelOf)).join('')}` : '';
      }).join('')}
      <div class="pmd-form-actions"><button type="button" class="pmd-button" data-close>Fermer</button></div>
    </div>`, true);
  layer.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-lof-ask]')) askChat('Legal Ontologies Foundry', 'LOF', ASK_NOTE, {});
  });
  return async () => {};
}

export async function editOntology(root: HTMLElement, projectId: string, onSaved: () => void, projectPath = '', initial = 'relations'): Promise<void> {
  const tabs = [['relations', 'LOF'], ['tree', 'Classement']];
  const layer = modal(root, `<h2 class="pmd-title piecemaker-display">Ontologie</h2><div class="pmd-settings-tabs" role="tablist" aria-label="Ontologie">${tabs.map(([id, label]) => `<button type="button" class="pmd-button" role="tab" id="pmd-settings-${id}" aria-controls="pmd-pane-${id}" data-settings-tab="${id}" aria-selected="false">${label}</button>`).join('')}</div>${tabs.map(([id]) => `<section role="tabpanel" id="pmd-pane-${id}" aria-labelledby="pmd-settings-${id}" data-settings-pane="${id}" hidden></section>`).join('')}<div class="pmd-error" data-settings-error role="alert" hidden></div><div class="pmd-form-actions"><button type="button" class="pmd-button" data-close>Annuler</button><button type="button" class="pmd-button pmd-button-primary" data-settings-save>Enregistrer</button></div>`);
  const saved = () => { layer.remove(); onSaved(); };
  const mounted = new Set<string>();
  const saves = new Map<string, () => Promise<void>>();
  const show = async (id: string) => {
    layer.querySelectorAll<HTMLElement>('[data-settings-pane]').forEach((pane) => { pane.hidden = pane.dataset.settingsPane !== id; });
    layer.querySelectorAll<HTMLElement>('[data-settings-tab]').forEach((button) => { button.setAttribute('aria-selected', String(button.dataset.settingsTab === id)); });
    if (mounted.has(id)) return;
    mounted.add(id);
    const pane = layer.querySelector<HTMLElement>(`[data-settings-pane="${id}"]`)!;
    try {
      const save = id === 'relations' ? await showLof(pane, projectId) : await editClassification(pane, projectPath, saved, true);
      saves.set(id, save);
      pane.querySelector('.pmd-form-actions')?.remove();
    } catch (error) {
      mounted.delete(id);
      const message = layer.querySelector<HTMLElement>('[data-settings-error]')!;
      message.textContent = error instanceof Error ? error.message : String(error);
      message.hidden = false;
    }
  };
  const saveAll = async () => {
    const button = layer.querySelector<HTMLButtonElement>('[data-settings-save]')!;
    if (button.disabled || saves.size !== mounted.size) return;
    button.disabled = true;
    try {
      for (const save of saves.values()) await save();
      if (saves.has('tree')) await okfApi.rebuild(projectId);
      saved();
    }
    catch (error) {
      const message = layer.querySelector<HTMLElement>('[data-settings-error]')!;
      message.textContent = error instanceof Error ? error.message : String(error);
      message.hidden = false;
    } finally { button.disabled = false; }
  };
  layer.addEventListener('submit', (event) => { event.preventDefault(); event.stopPropagation(); void saveAll(); }, true);
  layer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-settings-save]')) void saveAll();
    const tab = target.closest<HTMLElement>('[data-settings-tab]');
    if (tab) void show(tab.dataset.settingsTab!);
    if (target.closest('[data-close]')) layer.remove();
  });
  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') layer.remove();
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-settings-tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex(([id]) => id === tab.dataset.settingsTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    layer.querySelector<HTMLElement>(`[data-settings-tab="${tabs[next][0]}"]`)?.focus();
    void show(tabs[next][0]);
  });
  await show(initial);
}
