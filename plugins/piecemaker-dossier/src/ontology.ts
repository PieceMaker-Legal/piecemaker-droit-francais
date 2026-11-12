import { modal } from './editors.js';
import { okfApi, PARTY_TYPE, PREMISE_TYPE, type OntologyRelation, type OntologyState } from './okf.js';
import { askChat as ask, chatAttributes as attributes, type ChatPlace } from './chat-pick.js';
import { applyChange, ontologyChanges, proposalMarkup, type ChangeDecision } from './ontology-proposal.js';
import { decisionOf } from './proposal.js';
import { escapeHtml } from './views.js';

const ASK_NOTE = 'ontologie commune à tous les dossiers, lue par pm okf ontologie ; pour la changer, modifiez ~/.piecemaker/ontologie.json avec Edit ou Write : le hook en fait une proposition, l’avocat décide';

const blank = (): OntologyRelation => ({ name: '', label: '', inverse: '', description: '', source: [], target: [] });

export function ontologyTypes(state: OntologyState): string[] {
  const used = state.relations.flatMap((relation) => [...relation.source, ...relation.target]);
  return [...new Set([...state.types, ...used])].filter((type) => type !== PREMISE_TYPE && type !== PARTY_TYPE);
}

function typeChecks(types: string[], selected: string[], side: 'source' | 'target'): string {
  return `<div class="pmd-ontology-types" data-ontology-${side}>${types.map((type) => `<label><input type="checkbox" value="${escapeHtml(type)}"${selected.includes(type) ? ' checked' : ''}> ${escapeHtml(type)}</label>`).join('')}</div>`;
}

const chatAttributes = (title: string, kind: string, place: ChatPlace) => attributes(title, kind, ASK_NOTE, place);
const askChat = (title: string, kind: string, place: ChatPlace) => ask(title, kind, ASK_NOTE, place);

function relationMarkup(relation: OntologyRelation, index: number, types: string[], place: ChatPlace): string {
  return `
    <div class="pmd-form-section" data-ontology-row${relation.name ? chatAttributes(relation.name, 'Relation', place) : ''}>
      <div class="pmd-ontology-head">
        <label>Nom technique<input class="pmd-input" data-ontology-name maxlength="40" value="${escapeHtml(relation.name)}" placeholder="conteste"></label>
        <label>Libellé<input class="pmd-input" data-ontology-label maxlength="60" value="${escapeHtml(relation.label)}" placeholder="conteste"></label>
        <label>Libellé inverse<input class="pmd-input" data-ontology-inverse maxlength="60" value="${escapeHtml(relation.inverse)}" placeholder="contesté par"></label>
        <button type="button" class="pmd-icon-button" data-ontology-ask="${index}" title="Demander à l’assistant sur cette relation" aria-label="Demander à l’assistant sur cette relation">?</button>
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
  let state = await okfApi.ontology(projectId);
  const proposed = state.proposition?.relations ?? [];
  const types = ontologyTypes({ ...state, relations: [...state.relations, ...proposed] });
  const changes = state.proposition ? ontologyChanges(state.relations, proposed) : [];
  const decisions: Array<ChangeDecision | undefined> = changes.map(() => undefined);
  let relations = state.relations;
  const fileShown = Boolean(state.fichier && state.total);
  const placeOf = (name: string): ChatPlace => {
    const lines = state.lignes?.[name];
    return fileShown && lines ? { fichier: state.fichier, ...lines } : {};
  };
  const wholePlace = (): ChatPlace => (fileShown ? { fichier: state.fichier, debut: 1, fin: state.total } : {});
  const rowsHtml = () => relations.map((relation, index) => relationMarkup(relation, index, types, placeOf(relation.name))).join('');
  const proposalHtml = () => (state.proposition ? proposalMarkup(changes, decisions, state.proposition.motif) : '');
  const system = state.systeme.map((relation) => `<li><strong>${escapeHtml(relation.label)}</strong> <code>${escapeHtml(relation.name)}</code> : ${escapeHtml(relation.source)} → ${escapeHtml(relation.target)}. ${escapeHtml(relation.description)}</li>`).join('');
  const layer = modal(root, `
    <form class="pmd-form" data-ontology-form${chatAttributes('Ontologie des liens', 'Ontologie', wholePlace())}>
      <div class="pmd-ontology-change-head"><h2 class="pmd-title piecemaker-display">Ontologie des liens</h2><span class="pmd-spacer"></span><button type="button" class="pmd-button" data-ontology-ask-all>Demander à l’assistant</button></div>
      <p class="pmd-form-note">Les relations admises entre documents, et les types de documents qu’elles relient. Cette ontologie est commune à tous les dossiers : une relation ne s’applique que là où ses types existent. Les types sont les dossiers de premier niveau de l’arborescence. L’assistant ne pose que ces liens ; il peut proposer de modifier cette liste, et vous acceptez, refusez ou modifiez chaque changement. « Vérifier l’index » signale les liens qui en sortent.</p>
      ${state.erreur ? `<div class="pmd-error" role="alert">${escapeHtml(state.erreur)}</div>` : ''}
      <div data-ontology-proposal>${proposalHtml()}</div>
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
  const proposalHost = layer.querySelector<HTMLElement>('[data-ontology-proposal]')!;
  const showError = (error: unknown) => {
    const message = layer.querySelector<HTMLElement>('[data-ontology-error]')!;
    message.textContent = error instanceof Error ? error.message : String(error);
    message.hidden = false;
  };
  const decide = (index: number, decision: ChangeDecision) => {
    decisions[index] = decision;
    relations = readOntologyRows(list);
    if (decision !== 'refusee') relations = applyChange(relations, changes[index]);
    list.innerHTML = rowsHtml();
    proposalHost.innerHTML = proposalHtml();
    if (decision !== 'modifiee') return;
    const row = list.querySelectorAll<HTMLElement>('[data-ontology-row]')[relations.findIndex((relation) => relation.name === changes[index].name)];
    row?.classList.add('pmd-ontology-row-edited');
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector<HTMLInputElement>('[data-ontology-label]')?.focus();
  };
  layer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const choice = decisionOf(target);
    if (choice) return decide(choice.index, choice.decision);
    if (target.closest('[data-proposal-drop]')) {
      void okfApi.dropProposal(projectId).then(() => { state = { ...state, proposition: null }; proposalHost.innerHTML = ''; }).catch(showError);
      return;
    }
    if (target.closest('[data-ontology-ask-all]')) return askChat('Ontologie des liens', 'Ontologie', wholePlace());
    const ask = target.closest<HTMLElement>('[data-ontology-ask]');
    if (ask) {
      const relation = readOntologyRows(list)[Number(ask.dataset.ontologyAsk)];
      if (relation?.name) askChat(relation.name, 'Relation', placeOf(relation.name));
      return;
    }
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
    void okfApi.saveOntology(projectId, readOntologyRows(list)).then(() => { layer.remove(); onSaved(); }).catch(showError).finally(() => { submit.disabled = false; });
  });
  list.querySelector<HTMLInputElement>('[data-ontology-name]')?.focus();
}
