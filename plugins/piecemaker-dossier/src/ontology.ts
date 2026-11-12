import { modal } from './editors.js';
import { okfApi, type OntologyRelation } from './okf.js';
import { askChat as ask, chatAttributes as attributes, type ChatPlace } from './chat-pick.js';
import { applyChange, ontologyChanges, proposalMarkup, type ChangeDecision } from './ontology-proposal.js';
import { decisionOf } from './proposal.js';
import { escapeHtml } from './views.js';

const ASK_NOTE = 'ontologie commune à tous les dossiers, lue par pm okf ontologie ; pour la changer, modifiez ~/.piecemaker/ontologie.json avec Edit ou Write : le hook en fait une proposition, l’avocat décide';

const PIECES = 'Pièces';

const blank = (): OntologyRelation => ({ name: '', label: '', inverse: '', description: '', source: [PIECES], target: [PIECES] });

const chatAttributes = (title: string, kind: string, place: ChatPlace) => attributes(title, kind, ASK_NOTE, place);
const askChat = (title: string, kind: string, place: ChatPlace) => ask(title, kind, ASK_NOTE, place);

function relationMarkup(relation: OntologyRelation, index: number, place: ChatPlace): string {
  return `
    <div class="pmd-form-section pmd-ontology-row" data-ontology-row${relation.name ? chatAttributes(relation.name, 'Relation', place) : ''}>
      <div class="pmd-ontology-head">
        <input class="pmd-input pmd-ontology-name" data-ontology-name maxlength="40" value="${escapeHtml(relation.name)}" placeholder="nom-technique" aria-label="Nom technique">
        <button type="button" class="pmd-icon-button" data-ontology-ask="${index}" title="Demander à l’assistant sur ce lien" aria-label="Demander à l’assistant sur ce lien">?</button>
        <button type="button" class="pmd-icon-button" data-ontology-remove="${index}" title="Supprimer ce lien" aria-label="Supprimer ce lien">×</button>
      </div>
      <div class="pmd-ontology-labels">
        <label title="Libellé">→<input class="pmd-input" data-ontology-label maxlength="60" value="${escapeHtml(relation.label)}" placeholder="conteste" aria-label="Libellé"></label>
        <label title="Libellé inverse">←<input class="pmd-input" data-ontology-inverse maxlength="60" value="${escapeHtml(relation.inverse)}" placeholder="contesté par" aria-label="Libellé inverse"></label>
      </div>
      <input class="pmd-input" data-ontology-description maxlength="500" value="${escapeHtml(relation.description)}" placeholder="Quand poser ce lien" aria-label="Description">
    </div>`;
}

export function readOntologyRows(list: HTMLElement): OntologyRelation[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-ontology-row]')).map((row) => ({
    name: row.querySelector<HTMLInputElement>('[data-ontology-name]')!.value.trim(),
    label: row.querySelector<HTMLInputElement>('[data-ontology-label]')!.value.trim(),
    inverse: row.querySelector<HTMLInputElement>('[data-ontology-inverse]')!.value.trim(),
    description: row.querySelector<HTMLInputElement>('[data-ontology-description]')!.value.trim(),
    source: [PIECES],
    target: [PIECES],
  }));
}

export async function editOntology(root: HTMLElement, projectId: string, onSaved: () => void): Promise<void> {
  let state = await okfApi.ontology(projectId);
  const proposed = state.proposition?.relations ?? [];
  const changes = state.proposition ? ontologyChanges(state.relations, proposed) : [];
  const decisions: Array<ChangeDecision | undefined> = changes.map(() => undefined);
  let relations = state.relations;
  const fileShown = Boolean(state.fichier && state.total);
  const placeOf = (name: string): ChatPlace => {
    const lines = state.lignes?.[name];
    return fileShown && lines ? { fichier: state.fichier, ...lines } : {};
  };
  const wholePlace = (): ChatPlace => (fileShown ? { fichier: state.fichier, debut: 1, fin: state.total } : {});
  const rowsHtml = () => relations.map((relation, index) => relationMarkup(relation, index, placeOf(relation.name))).join('');
  const proposalHtml = () => (state.proposition ? proposalMarkup(changes, decisions, state.proposition.motif) : '');
  const system = state.systeme.map((relation) => `<li><strong>${escapeHtml(relation.label)}</strong> <code>${escapeHtml(relation.name)}</code> : ${escapeHtml(relation.source)} → ${escapeHtml(relation.target)}. ${escapeHtml(relation.description)}</li>`).join('');
  const layer = modal(root, `
    <form class="pmd-form" data-ontology-form${chatAttributes('Ontologie des liens', 'Ontologie', wholePlace())}>
      <div class="pmd-ontology-change-head"><h2 class="pmd-title piecemaker-display">Ontologie des liens</h2><span class="pmd-spacer"></span><button type="button" class="pmd-button" data-ontology-ask-all>Demander à l’assistant</button></div>
      <p class="pmd-form-note">Communs à tous les dossiers. L’assistant ne pose que ces liens et peut en proposer d’autres.</p>
      ${state.erreur ? `<div class="pmd-error" role="alert">${escapeHtml(state.erreur)}</div>` : ''}
      <div data-ontology-proposal>${proposalHtml()}</div>
      <div class="pmd-form" data-ontology-rows>${rowsHtml()}</div>
      <button type="button" class="pmd-button" data-ontology-add>Créer un autre lien</button>
      <div class="pmd-form-section"><h3>Liens système</h3><ul class="pmd-form-note">${system}</ul></div>
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
