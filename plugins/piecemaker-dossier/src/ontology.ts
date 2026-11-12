import { modal } from './editors.js';
import { okfApi, PARTY_TYPE, PREMISE_TYPE, type OntologyRelation, type OntologyState } from './okf.js';
import { escapeHtml } from './views.js';

const blank = (): OntologyRelation => ({ name: '', label: '', inverse: '', description: '', source: [], target: [] });

export function ontologyTypes(state: OntologyState): string[] {
  const used = state.relations.flatMap((relation) => [...relation.source, ...relation.target]);
  return [...new Set([...state.types, ...used])].filter((type) => type !== PREMISE_TYPE && type !== PARTY_TYPE);
}

function typeChecks(types: string[], selected: string[], side: 'source' | 'target'): string {
  return `<div class="pmd-ontology-types" data-ontology-${side}>${types.map((type) => `<label><input type="checkbox" value="${escapeHtml(type)}"${selected.includes(type) ? ' checked' : ''}> ${escapeHtml(type)}</label>`).join('')}</div>`;
}

function relationMarkup(relation: OntologyRelation, index: number, types: string[]): string {
  return `
    <div class="pmd-form-section" data-ontology-row>
      <div class="pmd-ontology-head">
        <label>Nom technique<input class="pmd-input" data-ontology-name maxlength="40" value="${escapeHtml(relation.name)}" placeholder="conteste"></label>
        <label>Libellé<input class="pmd-input" data-ontology-label maxlength="60" value="${escapeHtml(relation.label)}" placeholder="conteste"></label>
        <label>Libellé inverse<input class="pmd-input" data-ontology-inverse maxlength="60" value="${escapeHtml(relation.inverse)}" placeholder="contesté par"></label>
        <button type="button" class="pmd-icon-button" data-ontology-remove="${index}" title="Supprimer cette relation" aria-label="Supprimer cette relation">×</button>
      </div>
      <label>Description<input class="pmd-input" data-ontology-description maxlength="500" value="${escapeHtml(relation.description)}" placeholder="Quand poser ce lien"></label>
      <div class="pmd-ontology-side"><span>Source</span>${typeChecks(types, relation.source, 'source')}</div>
      <div class="pmd-ontology-side"><span>Cible</span>${typeChecks(types, relation.target, 'target')}</div>
    </div>`;
}

const checked = (row: HTMLElement, side: 'source' | 'target') => Array.from(row.querySelectorAll<HTMLInputElement>(`[data-ontology-${side}] input:checked`)).map((input) => input.value);

export function readOntologyRows(list: HTMLElement): OntologyRelation[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-ontology-row]')).map((row) => ({
    name: row.querySelector<HTMLInputElement>('[data-ontology-name]')!.value.trim(),
    label: row.querySelector<HTMLInputElement>('[data-ontology-label]')!.value.trim(),
    inverse: row.querySelector<HTMLInputElement>('[data-ontology-inverse]')!.value.trim(),
    description: row.querySelector<HTMLInputElement>('[data-ontology-description]')!.value.trim(),
    source: checked(row, 'source'),
    target: checked(row, 'target'),
  }));
}

export async function editOntology(root: HTMLElement, projectId: string, onSaved: () => void): Promise<void> {
  const state = await okfApi.ontology(projectId);
  const types = ontologyTypes(state);
  let relations = state.relations;
  const rowsHtml = () => relations.map((relation, index) => relationMarkup(relation, index, types)).join('');
  const system = state.systeme.map((relation) => `<li><strong>${escapeHtml(relation.label)}</strong> <code>${escapeHtml(relation.name)}</code> : ${escapeHtml(relation.source)} → ${escapeHtml(relation.target)}. ${escapeHtml(relation.description)}</li>`).join('');
  const layer = modal(root, `
    <form class="pmd-form" data-ontology-form>
      <h2 class="pmd-title piecemaker-display">Ontologie des liens</h2>
      <p class="pmd-form-note">Les relations admises entre documents, et les types de documents qu’elles relient. Les types sont les dossiers de premier niveau de l’arborescence. L’assistant ne pose que ces liens et ne modifie pas cette liste. « Vérifier l’index » signale les liens qui en sortent.</p>
      ${state.erreur ? `<div class="pmd-error" role="alert">${escapeHtml(state.erreur)}</div>` : ''}
      <div class="pmd-form" data-ontology-rows>${rowsHtml()}</div>
      <button type="button" class="pmd-button" data-ontology-add>+ Relation</button>
      <div class="pmd-form-section"><h3>Relations système (non modifiables)</h3><ul class="pmd-form-note">${system}</ul></div>
      <div class="pmd-error" data-ontology-error role="alert" hidden></div>
      <div class="pmd-form-actions">
        <button type="button" class="pmd-button" data-close>Annuler</button>
        <button type="submit" class="pmd-button pmd-button-primary">Enregistrer</button>
      </div>
    </form>`);
  const list = layer.querySelector<HTMLElement>('[data-ontology-rows]')!;
  layer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const remove = target.closest<HTMLElement>('[data-ontology-remove]');
    if (!remove && !target.closest('[data-ontology-add]')) return;
    relations = readOntologyRows(list);
    if (remove) relations.splice(Number(remove.dataset.ontologyRemove), 1);
    else relations.push(blank());
    list.innerHTML = rowsHtml();
    if (!remove) list.querySelectorAll<HTMLInputElement>('[data-ontology-name]')[relations.length - 1]?.focus();
  });
  layer.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); layer.remove(); } });
  layer.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = layer.querySelector<HTMLButtonElement>('[type="submit"]')!;
    if (submit.disabled) return;
    submit.disabled = true;
    void okfApi.saveOntology(projectId, readOntologyRows(list)).then(() => { layer.remove(); onSaved(); }).catch((error: unknown) => {
      const message = layer.querySelector<HTMLElement>('[data-ontology-error]')!;
      message.textContent = error instanceof Error ? error.message : String(error);
      message.hidden = false;
    }).finally(() => { submit.disabled = false; });
  });
  list.querySelector<HTMLInputElement>('[data-ontology-name]')?.focus();
}
