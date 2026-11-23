import { editClassification } from './classification.js';
import { modal } from './editors.js';
import { okfApi, type LofPattern } from './okf.js';
import { askChat, chatAttributes } from './chat-pick.js';
import { escapeHtml } from './views.js';

const ASK_NOTE = 'patterns de la Legal Ontologies Foundry (ODP-001 à 006), lus par pm okf ontologie ; ils ne se modifient pas';
const ATTRIBUTION = 'Legal Ontologies Foundry, David R. Koepsell, CC BY 4.0.';

function patternMarkup(pattern: LofPattern): string {
  return `<details class="pmd-form-section pmd-ontology-row" data-lof-term="${escapeHtml(pattern.id)}"${chatAttributes(pattern.title, 'LOF', ASK_NOTE, {})}>
    <summary><strong>${escapeHtml(pattern.title)}</strong> <code>${escapeHtml(pattern.id)}</code></summary>
    <p class="pmd-form-note">${escapeHtml(pattern.description)}</p>
    <pre class="pmd-fact-text">${escapeHtml(pattern.body)}</pre>
  </details>`;
}

async function showLof(root: HTMLElement, projectId: string): Promise<() => Promise<void>> {
  const state = await okfApi.ontology(projectId);
  const layer = modal(root, `
    <div class="pmd-form" data-lof-view>
      <div class="pmd-ontology-change-head"><h2 class="pmd-title piecemaker-display">Legal Ontologies Foundry</h2><span class="pmd-spacer"></span><button type="button" class="pmd-button" data-lof-ask>Demander à l’assistant</button></div>
      <p class="pmd-form-note">${ATTRIBUTION}</p>
      ${state.erreur ? `<div class="pmd-error" role="alert">${escapeHtml(state.erreur)}</div>` : ''}
      ${state.patterns.map(patternMarkup).join('')}
      <div class="pmd-form-actions"><button type="button" class="pmd-button" data-close>Fermer</button></div>
    </div>`, true);
  layer.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-lof-ask]')) askChat('Legal Ontologies Foundry', 'LOF', ASK_NOTE, {});
  });
  return async () => {};
}

export async function editOntology(root: HTMLElement, projectId: string, onSaved: () => void, projectPath = '', initial = 'relations'): Promise<void> {
  const tabs = [['relations', 'Socle LOF'], ['tree', 'Classement']];
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
