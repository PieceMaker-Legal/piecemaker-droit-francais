import { classificationApi } from './api.js';
import { modal } from './editors.js';
import { escapeHtml } from './views.js';

export async function editClassification(root: HTMLElement, project: string): Promise<void> {
  const { folders } = await classificationApi.read(project);
  let rows = folders.map((folder) => ({ ...folder }));
  const rowsHtml = () => rows.map((folder, index) => `
    <div class="pmd-tree-row" data-tree-row>
      <input class="pmd-input" data-tree-name maxlength="60" value="${escapeHtml(folder.name)}" placeholder="Dossier" aria-label="Nom du dossier">
      <input class="pmd-input" data-tree-explanation maxlength="500" value="${escapeHtml(folder.explanation)}" placeholder="Ce qu’on y range" aria-label="Explication du dossier">
      <button type="button" class="pmd-icon-button" data-tree-remove="${index}" aria-label="Supprimer ce dossier">×</button>
    </div>`).join('');
  const layer = modal(root, `
    <form class="pmd-form" data-tree-form>
      <h2 class="pmd-title piecemaker-display">Arborescence du dossier</h2>
      <p class="pmd-form-note">L’IA classe chaque document d’après ces explications. Utilisez « / » pour un sous-dossier. Vous pouvez aussi demander à l’assistant de modifier cette arborescence. Enregistrer ne déplace aucun fichier.</p>
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
      name: row.querySelector<HTMLInputElement>('[data-tree-name]')!.value,
      explanation: row.querySelector<HTMLInputElement>('[data-tree-explanation]')!.value,
    }));
  };
  layer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const remove = target.closest<HTMLElement>('[data-tree-remove]');
    if (!remove && !target.closest('[data-tree-add]')) return;
    sync();
    if (remove) rows.splice(Number(remove.dataset.treeRemove), 1);
    else rows.push({ name: '', explanation: '' });
    list.innerHTML = rowsHtml();
    if (!remove) list.querySelector<HTMLInputElement>('[data-tree-row]:last-child [data-tree-name]')?.focus();
  });
  layer.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); layer.remove(); } });
  layer.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = layer.querySelector<HTMLButtonElement>('[type="submit"]')!;
    if (submit.disabled) return;
    sync();
    submit.disabled = true;
    void classificationApi.save(project, rows.filter((row) => row.name.trim())).then(() => layer.remove()).catch((error: unknown) => {
      const message = layer.querySelector<HTMLElement>('[data-tree-error]')!;
      message.textContent = error instanceof Error ? error.message : String(error);
      message.hidden = false;
    }).finally(() => { submit.disabled = false; });
  });
  layer.querySelector<HTMLInputElement>('[data-tree-name]')?.focus();
}
