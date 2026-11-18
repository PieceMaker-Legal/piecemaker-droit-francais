import { classificationApi, type ClassificationFolder } from './api.js';
import { askChat, chatAttributes, type ChatPlace } from './chat-pick.js';
import { modal } from './editors.js';
import { applyKeyedChange, changesMarkup, decisionOf, keyedChanges, type ChangeDecision, type ProposalShape } from './proposal.js';
import { escapeHtml } from './views.js';

const ASK_NOTE = 'arborescence commune à tous les dossiers, lue avec pm dossier arborescence ; pour la changer, modifiez la clé « arborescence » de ~/.piecemaker/ontologie.json avec Edit ou Write : le hook en fait une proposition, l’avocat décide';

export const TREE_SHAPE: ProposalShape<ClassificationFolder> = {
  key: (folder) => folder.name,
  fields: [['explanation', 'Explication'], ['type', 'Type principal']],
  empty: (name) => ({ name, explanation: '' }),
  unchanged: 'La proposition reprend l’arborescence actuelle sans changement.',
};

export const treeChanges = (current: ClassificationFolder[], proposed: ClassificationFolder[]) => keyedChanges(TREE_SHAPE, current, proposed);

type TreeRow = ClassificationFolder & { depth: number };

export function treeRows(folders: ClassificationFolder[]): TreeRow[] {
  const known = new Set(folders.map((folder) => folder.name));
  const parentOf = (name: string): string => {
    for (let cut = name.lastIndexOf('/'); cut > 0; cut = name.lastIndexOf('/', cut - 1)) {
      if (known.has(name.slice(0, cut))) return name.slice(0, cut);
    }
    return '';
  };
  const childrenOf = (parent: string, depth: number): TreeRow[] => folders
    .filter((folder) => parentOf(folder.name) === parent)
    .flatMap((folder) => [
      { ...folder, depth, name: parent ? folder.name.slice(parent.length + 1) : folder.name },
      ...childrenOf(folder.name, depth + 1),
    ]);
  return childrenOf('', 0);
}

export function treeFolders(rows: TreeRow[]): ClassificationFolder[] {
  const ancestors: string[] = [];
  return rows.flatMap((row) => {
    const name = row.name.trim();
    ancestors.length = row.depth;
    ancestors[row.depth] = name;
    return name ? [{ name: ancestors.filter(Boolean).join('/'), explanation: row.explanation, ...(row.type ? { type: row.type } : {}) }] : [];
  });
}

function fullNames(rows: TreeRow[]): string[] {
  const ancestors: string[] = [];
  return rows.map((row) => {
    ancestors.length = row.depth;
    ancestors[row.depth] = row.name.trim();
    return ancestors.filter(Boolean).join('/');
  });
}

function subtreeEnd(rows: TreeRow[], index: number): number {
  let end = index + 1;
  while (end < rows.length && rows[end].depth > rows[index].depth) end += 1;
  return end;
}

export async function editClassification(root: HTMLElement, project: string, onSaved: () => void = () => undefined, inline = false): Promise<() => Promise<void>> {
  let state = await classificationApi.read(project);
  const changes = state.proposition ? treeChanges(state.folders, state.proposition.dossiers) : [];
  const decisions: Array<ChangeDecision | undefined> = changes.map(() => undefined);
  let rows = treeRows(state.folders);
  const fileShown = Boolean(state.fichier && state.total);
  const placeOf = (name: string): ChatPlace => {
    const lines = state.lignes?.[name];
    return fileShown && lines ? { fichier: state.fichier, ...lines } : {};
  };
  const wholePlace = (): ChatPlace => (fileShown ? { fichier: state.fichier, debut: 1, fin: state.total } : {});
  const proposalHtml = () => (state.proposition ? changesMarkup(TREE_SHAPE, changes, decisions, state.proposition.motif) : '');
  const rowsHtml = () => {
    const names = fullNames(rows);
    return rows.map((folder, index) => `
    <div class="pmd-tree-row" data-tree-row data-tree-depth="${folder.depth}"${names[index] ? chatAttributes(names[index], 'Dossier', ASK_NOTE, placeOf(names[index])) : ''}>
      <input class="pmd-input" data-tree-name maxlength="60" style="margin-left:${folder.depth * 24}px;width:calc(100% - ${folder.depth * 24}px)" value="${escapeHtml(folder.name)}" placeholder="${folder.depth ? 'Sous-dossier' : 'Dossier'}" aria-label="Nom du dossier">
      <input class="pmd-input" data-tree-explanation maxlength="500" value="${escapeHtml(folder.explanation)}" placeholder="Ce qu’on y range" aria-label="Explication du dossier">
      <input class="pmd-input" data-tree-type list="pmd-primary-types" title="Type principal des documents dans ce dossier" maxlength="60" value="${escapeHtml(folder.type || '')}" placeholder="${folder.depth ? 'Hérite du parent' : escapeHtml(folder.name)}" aria-label="Type principal du dossier">
      <button type="button" class="pmd-icon-button" data-tree-ask="${index}" title="Demander à l’assistant sur ce dossier" aria-label="Demander à l’assistant sur ce dossier">?</button>
      <button type="button" class="pmd-icon-button" data-tree-add-child="${index}" title="Ajouter un sous-dossier" aria-label="Ajouter un sous-dossier">+</button>
      <button type="button" class="pmd-icon-button" data-tree-remove="${index}" title="Supprimer ce dossier et ses sous-dossiers" aria-label="Supprimer ce dossier et ses sous-dossiers">×</button>
    </div>`).join('');
  };
  const layer = modal(root, `
    <form class="pmd-form" data-tree-form${chatAttributes('Arborescence du dossier', 'Arborescence', ASK_NOTE, wholePlace())}>
      <div class="pmd-ontology-change-head"><h2 class="pmd-title piecemaker-display">Arborescence du dossier</h2><span class="pmd-spacer"></span><button type="button" class="pmd-button" data-tree-ask-all>Demander à l’assistant</button></div>
      <p class="pmd-form-note">L’IA classe chaque document d’après ces explications. Le bouton « + » d’une ligne ajoute un sous-dossier. Le type principal indique la catégorie (Pièces, Projets…) des documents rangés dans ce dossier. Sans type, le sous-dossier hérite de son parent. L’assistant peut proposer de modifier cette arborescence : vous acceptez, refusez ou modifiez chaque changement. Enregistrer ne déplace aucun fichier.</p>
      <div data-tree-proposal>${proposalHtml()}</div>
      <datalist id="pmd-primary-types">${[...new Set(state.folders.map((folder) => folder.type || folder.name.split('/')[0]))].map((type) => `<option value="${escapeHtml(type)}"></option>`).join('')}</datalist><div class="pmd-tree-labels"><span>Dossier</span><span>Contenu</span><span>Type principal</span></div>
      <div class="pmd-form" data-tree-rows>${rowsHtml()}</div>
      <button type="button" class="pmd-button" data-tree-add>+ Dossier</button>
      <div class="pmd-error" data-tree-error role="alert" hidden></div>
      <div class="pmd-form-actions">
        <button type="button" class="pmd-button" data-close>Annuler</button>
        <button type="submit" class="pmd-button pmd-button-primary">Enregistrer</button>
      </div>
    </form>`, inline);
  const list = layer.querySelector<HTMLElement>('[data-tree-rows]')!;
  const sync = () => {
    rows = Array.from(list.querySelectorAll<HTMLElement>('[data-tree-row]')).map((row) => ({
      depth: Number(row.dataset.treeDepth),
      name: row.querySelector<HTMLInputElement>('[data-tree-name]')!.value,
      explanation: row.querySelector<HTMLInputElement>('[data-tree-explanation]')!.value,
      type: row.querySelector<HTMLInputElement>('[data-tree-type]')!.value.trim() || undefined,
    }));
  };
  const proposalHost = layer.querySelector<HTMLElement>('[data-tree-proposal]')!;
  const showError = (error: unknown) => {
    const message = layer.querySelector<HTMLElement>('[data-tree-error]')!;
    message.textContent = error instanceof Error ? error.message : String(error);
    message.hidden = false;
  };
  const decide = (index: number, decision: ChangeDecision) => {
    decisions[index] = decision;
    sync();
    const folders = treeFolders(rows);
    rows = treeRows(decision === 'refusee' ? folders : applyKeyedChange(TREE_SHAPE, folders, changes[index]));
    list.innerHTML = rowsHtml();
    proposalHost.innerHTML = proposalHtml();
    if (decision !== 'modifiee') return;
    const row = list.querySelectorAll<HTMLElement>('[data-tree-row]')[fullNames(rows).indexOf(changes[index].name)];
    row?.classList.add('pmd-ontology-row-edited');
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector<HTMLInputElement>('[data-tree-explanation]')?.focus();
  };
  layer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const choice = decisionOf(target);
    if (choice) return decide(choice.index, choice.decision);
    if (target.closest('[data-proposal-drop]')) {
      void classificationApi.dropProposal(project).then(() => { state = { ...state, proposition: null }; proposalHost.innerHTML = ''; if (!inline) onSaved(); }).catch(showError);
      return;
    }
    if (target.closest('[data-tree-ask-all]')) return askChat('Arborescence du dossier', 'Arborescence', ASK_NOTE, wholePlace());
    const ask = target.closest<HTMLElement>('[data-tree-ask]');
    if (ask) {
      sync();
      const name = fullNames(rows)[Number(ask.dataset.treeAsk)];
      if (name) askChat(name, 'Dossier', ASK_NOTE, placeOf(name));
      return;
    }
    const remove = target.closest<HTMLElement>('[data-tree-remove]');
    const addChild = target.closest<HTMLElement>('[data-tree-add-child]');
    if (!remove && !addChild && !target.closest('[data-tree-add]')) return;
    sync();
    let focused = rows.length;
    if (remove) {
      const index = Number(remove.dataset.treeRemove);
      rows.splice(index, subtreeEnd(rows, index) - index);
    } else if (addChild) {
      const index = Number(addChild.dataset.treeAddChild);
      focused = subtreeEnd(rows, index);
      rows.splice(focused, 0, { depth: rows[index].depth + 1, name: '', explanation: '' });
    } else rows.push({ depth: 0, name: '', explanation: '' });
    list.innerHTML = rowsHtml();
    if (!remove) list.querySelectorAll<HTMLInputElement>('[data-tree-name]')[focused]?.focus();
  });
  layer.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); layer.remove(); } });
  const save = async () => {
    sync();
    await classificationApi.save(project, treeFolders(rows));
    if (!inline) { layer.remove(); onSaved(); }
  };
  layer.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = layer.querySelector<HTMLButtonElement>('[type="submit"]')!;
    if (submit.disabled) return;
    sync();
    submit.disabled = true;
    void save().catch(showError).finally(() => { submit.disabled = false; });
  });
  layer.querySelector<HTMLInputElement>('[data-tree-name]')?.focus();
  return save;
}
