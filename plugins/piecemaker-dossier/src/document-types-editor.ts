import { DEFAULT_DOCUMENT_TYPES, DOCUMENT_ICONS, iconSvg } from './document-types.js';
import type { DocumentType } from './document-types.js';
import { okfApi } from './okf.js';
import { escapeHtml } from './views.js';
import { askChat } from './chat-pick.js';
import { applyTypeChange, typeChanges, typesProposalMarkup, type ChangeDecision } from './ontology-proposal.js';
import { decisionOf } from './proposal.js';

export async function editDocumentTypes(host: HTMLElement, projectId: string, onSaved: () => void): Promise<() => Promise<void>> {
  const state = await okfApi.ontology(projectId);
  const types = state.documentTypes || DEFAULT_DOCUMENT_TYPES;
  const proposed = state.proposition?.documentTypes;
  const changes = proposed ? typeChanges(types, proposed) : [];
  const decisions: Array<ChangeDecision | undefined> = changes.map(() => undefined);
  const proposalHtml = () => (proposed ? typesProposalMarkup(changes, decisions, state.proposition?.motif || '') : '');
  const row = (type: DocumentType) => `<div class="pmd-document-type-row" data-document-type-row><span class="pmd-type-preview">${iconSvg(type.icon)}</span><input class="pmd-input" data-type-name maxlength="120" aria-label="Type de document" value="${escapeHtml(type.name)}"><select class="pmd-input" data-type-icon aria-label="Icône">${Object.entries(DOCUMENT_ICONS).map(([name, icon]) => `<option value="${name}" ${name === type.icon ? 'selected' : ''}>${escapeHtml(icon.label)}</option>`).join('')}</select><button type="button" class="pmd-icon-button" data-type-remove aria-label="Supprimer ce type">×</button></div>`;
  host.innerHTML = `<form class="pmd-form"><p class="pmd-form-note">Types communs à tous les dossiers. Supprimer un type conserve les documents existants ; leur icône devient celle d’un document.</p><button type="button" class="pmd-button" data-types-ask>Demander à l’assistant</button><div data-types-proposal>${proposalHtml()}</div><div class="pmd-form" data-types-list>${types.map(row).join('')}</div><button type="button" class="pmd-button" data-type-add>Ajouter un type</button><div class="pmd-error" data-types-error role="alert" hidden></div><div class="pmd-form-actions"><button type="button" class="pmd-button" data-close>Annuler</button><button type="submit" class="pmd-button pmd-button-primary">Enregistrer</button></div></form>`;
  const list = host.querySelector<HTMLElement>('[data-types-list]')!;
  const proposalHost = host.querySelector<HTMLElement>('[data-types-proposal]')!;
  const read = (): DocumentType[] => Array.from(list.querySelectorAll('[data-document-type-row]')).map((entry) => ({ name: entry.querySelector<HTMLInputElement>('[data-type-name]')!.value.trim(), icon: entry.querySelector<HTMLSelectElement>('[data-type-icon]')!.value }));
  host.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    if (target.matches('[data-type-icon]')) target.closest('[data-document-type-row]')!.querySelector('.pmd-type-preview')!.innerHTML = iconSvg(target.value);
  });
  const showError = (error: unknown) => {
    const message = host.querySelector<HTMLElement>('[data-types-error]')!;
    message.textContent = error instanceof Error ? error.message : String(error);
    message.hidden = false;
  };
  host.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const choice = decisionOf(target);
    if (choice) {
      decisions[choice.index] = choice.decision;
      const change = changes[choice.index];
      const next = choice.decision === 'refusee' ? read() : applyTypeChange(read(), change);
      list.innerHTML = next.map(row).join('');
      proposalHost.innerHTML = proposalHtml();
      if (choice.decision === 'modifiee') list.querySelectorAll<HTMLInputElement>('[data-type-name]')[next.findIndex((type) => type.name === change.name)]?.focus();
      return;
    }
    if (target.closest('[data-proposal-drop]')) {
      void okfApi.dropProposal(projectId, 'documentTypes').then(() => { proposalHost.innerHTML = ''; }).catch(showError);
      return;
    }
    if (target.closest('[data-type-remove]')) target.closest('[data-document-type-row]')!.remove();
    if (target.closest('[data-type-add]')) {
      list.insertAdjacentHTML('beforeend', row({ name: '', icon: 'file' }));
      list.lastElementChild?.querySelector<HTMLInputElement>('input')?.focus();
    }
    if (target.closest('[data-types-ask]')) askChat('Types de documents et icônes', 'Ontologie', `Lire pm okf ontologie. Proposer la liste complète avec pm okf types --json '[{"name":"contrat","icon":"pen"}]' : l’avocat accepte ou refuse chaque changement.`, { fichier: state.fichier });
  });
  const save = async () => { await okfApi.saveTypes(projectId, read()); };
  host.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = host.querySelector<HTMLButtonElement>('[type="submit"]')!;
    if (submit.disabled) return;
    submit.disabled = true;
    void save().then(onSaved).catch(showError).finally(() => { submit.disabled = false; });
  });
  return save;
}
