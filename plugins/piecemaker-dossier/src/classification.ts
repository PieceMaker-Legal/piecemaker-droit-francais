import { classificationApi, type ClassificationFolder } from './api.js';
import { modal } from './editors.js';
import { escapeHtml } from './views.js';

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
    return name ? [{ name: ancestors.filter(Boolean).join('/'), explanation: row.explanation }] : [];
  });
}

function subtreeEnd(rows: TreeRow[], index: number): number {
  let end = index + 1;
  while (end < rows.length && rows[end].depth > rows[index].depth) end += 1;
  return end;
}

export async function editClassification(root: HTMLElement, project: string): Promise<void> {
  const { folders } = await classificationApi.read(project);
  let rows = treeRows(folders);
  const rowsHtml = () => rows.map((folder, index) => `
    <div class="pmd-tree-row" data-tree-row data-tree-depth="${folder.depth}">
      <input class="pmd-input" data-tree-name maxlength="60" style="margin-left:${folder.depth * 24}px;width:calc(100% - ${folder.depth * 24}px)" value="${escapeHtml(folder.name)}" placeholder="${folder.depth ? 'Sous-dossier' : 'Dossier'}" aria-label="Nom du dossier">
      <input class="pmd-input" data-tree-explanation maxlength="500" value="${escapeHtml(folder.explanation)}" placeholder="Ce qu’on y range" aria-label="Explication du dossier">
      <button type="button" class="pmd-icon-button" data-tree-add-child="${index}" title="Ajouter un sous-dossier" aria-label="Ajouter un sous-dossier">+</button>
      <button type="button" class="pmd-icon-button" data-tree-remove="${index}" title="Supprimer ce dossier et ses sous-dossiers" aria-label="Supprimer ce dossier et ses sous-dossiers">×</button>
    </div>`).join('');
  const layer = modal(root, `
    <form class="pmd-form" data-tree-form>
      <h2 class="pmd-title piecemaker-display">Arborescence du dossier</h2>
      <p class="pmd-form-note">L’IA classe chaque document d’après ces explications. Le bouton « + » d’une ligne ajoute un sous-dossier. Vous pouvez aussi demander à l’assistant de modifier cette arborescence. Enregistrer ne déplace aucun fichier.</p>
      <div class="pmd-form" data-tree-rows>${rowsHtml()}</div>
      <button type="button" class="pmd-button" data-tree-add>+ Dossier</button>
      <div class="pmd-error" data-tree-error role="alert" hidden></div>
      <div class="pmd-form-actions">
        <button type="button" class="pmd-button" data-close>Annuler</button>
        <button type="submit" class="pmd-button pmd-button-primary">Enregistrer</button>
      </div>
    </form>`);
  const list = layer.querySelector<HTMLElement>('[data-tree-rows]')!;
  const sync = () => {
    rows = Array.from(list.querySelectorAll<HTMLElement>('[data-tree-row]')).map((row) => ({
      depth: Number(row.dataset.treeDepth),
      name: row.querySelector<HTMLInputElement>('[data-tree-name]')!.value,
      explanation: row.querySelector<HTMLInputElement>('[data-tree-explanation]')!.value,
    }));
  };
  layer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
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
  layer.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = layer.querySelector<HTMLButtonElement>('[type="submit"]')!;
    if (submit.disabled) return;
    sync();
    submit.disabled = true;
    void classificationApi.save(project, treeFolders(rows)).then(() => layer.remove()).catch((error: unknown) => {
      const message = layer.querySelector<HTMLElement>('[data-tree-error]')!;
      message.textContent = error instanceof Error ? error.message : String(error);
      message.hidden = false;
    }).finally(() => { submit.disabled = false; });
  });
  layer.querySelector<HTMLInputElement>('[data-tree-name]')?.focus();
}
