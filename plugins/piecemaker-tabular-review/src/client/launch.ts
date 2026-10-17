import type { Draft, Provider, ReviewDetail, RowRequest, TemplateColumn } from '../shared.js';
import { COLUMN_FORMATS, DEFAULT_MODEL, DEFAULT_PROVIDER, hasActions, REVIEW_FOLDER } from '../shared.js';
import type { App, View } from './app.js';
import { basename, confirmDialog, errorMessage, escapeHtml, toast } from './dom.js';
import { openDocumentsDrawer } from './documents-drawer.js';
import { anonymizationProxyOrigin, loadModels } from './host.js';
import type { ModelOption } from './host.js';
import { nextSort, sortBy, sortButton } from './ordering.js';
import type { SortState } from './ordering.js';
import { openQuestionsDrawer } from './questions-drawer.js';

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'mistral', label: 'Mistral' },
];

const CUSTOM_TEMPLATE = 'Questions personnalisées';

function filenamePreview(templateName: string, title: string): string {
  const now = new Date();
  const stamp = [now.getFullYear() % 100, now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
  const template = /^analyse tabulaire/i.test(templateName) ? templateName : `Analyse Tabulaire ${templateName}`;
  return `${stamp} - ${template} - ${title || '…'}`;
}

export function createLaunchView(app: App, draft: Draft, onBack: () => void): View {
  const { project, title } = draft;
  const element = document.createElement('div');
  element.className = 'ptr-launch';
  element.innerHTML = `
    <div class="ptr-launch-body">
      <div class="ptr-review-top">
        <button type="button" class="ptr-icon-button" data-back aria-label="Retour à l’historique" title="Retour à l’historique">←</button>
        <div class="ptr-review-heading">
          <span class="ptr-review-title">${escapeHtml(title)}</span>
          <span class="ptr-small ptr-muted ptr-ellipsis">Nouveau tableau · ${escapeHtml(app.projectName(project))}</span>
        </div>
      </div>
      <div data-notice></div>
      <div class="ptr-table-wrap" data-table></div>
    </div>
    <div class="ptr-launch-bar">
      <div class="ptr-launch-controls">
        <label class="ptr-bar-field"><span class="ptr-bar-label">IA</span><select class="ptr-select" data-provider>${PROVIDERS.map((provider) => `<option value="${provider.value}">${provider.label}</option>`).join('')}</select></label>
        <label class="ptr-bar-field"><span class="ptr-bar-label">Modèle</span><select class="ptr-select" data-model></select></label>
        <label class="ptr-bar-field"><span class="ptr-bar-label" title="Sessions simultanées">En parallèle</span><select class="ptr-select" data-concurrency>${[1, 2, 3, 4, 5, 6, 8].map((value) => `<option value="${value}"${value === 3 ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
        <span data-model-warning></span>
        <span class="ptr-spacer"></span>
        <span class="ptr-small ptr-muted ptr-filename" data-filename></span>
        <button type="button" class="ptr-button ptr-button-primary" data-launch>Lancer l’analyse tabulaire</button>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(selector: string) => element.querySelector<T>(selector)!;
  const providerSelect = $<HTMLSelectElement>('[data-provider]');
  const modelSelect = $<HTMLSelectElement>('[data-model]');
  const concurrencySelect = $<HTMLSelectElement>('[data-concurrency]');

  let columns: TemplateColumn[] = [...draft.columns];
  let templateName = draft.templateName || CUSTOM_TEMPLATE;
  let rows: RowRequest[] = [...draft.rows];
  let sort: SortState = null;
  let protectedProject = true;
  let models: { options: ModelOption[]; cheapest: string } = { options: [], cheapest: '' };
  let launching = false;
  let preferredModel = draft.model ?? DEFAULT_MODEL[draft.provider ?? DEFAULT_PROVIDER];

  const isSorting = () => hasActions(columns);

  function renderNotice() {
    $('[data-notice]').innerHTML = protectedProject
      ? ''
      : '<div class="ptr-warning">Ce dossier n’est pas sous bouclier vert (anonymisation non terminée ou protection levée) : vérifiez que les documents Markdown sélectionnés sont bien pseudonymisés.</div>';
  }

  function renderTable() {
    const ordered = sortBy(rows.map((row, index) => ({ row, index })), sort, ({ row }) => row.label);
    $('[data-table]').innerHTML = `
      <table class="ptr-table">
        <thead><tr>
          <th scope="col"><div class="ptr-th-sortable"><span>Document</span>${sortButton(sort, 'label', 'document')}</div></th>
          ${columns.map((column, index) => `<th scope="col"><div class="ptr-th-stack"><div class="ptr-th-sortable"><input class="ptr-input ptr-ghost ptr-th-title" data-column-title="${index}" value="${escapeHtml(column.name)}" maxlength="120" aria-label="Titre de la colonne" placeholder="Titre (facultatif)"><span class="ptr-chip" title="Type de réponse">${escapeHtml(COLUMN_FORMATS.find((format) => format.value === column.format)?.label)}</span><button type="button" class="ptr-sort" data-remove-column="${index}" aria-label="Retirer la question" title="Retirer la question">×</button></div><textarea class="ptr-textarea ptr-ghost ptr-th-input" rows="2" maxlength="4000" data-column-prompt="${index}" aria-label="Question de la colonne" placeholder="Question posée à l’IA">${escapeHtml(column.prompt)}</textarea></div></th>`).join('')}
          <th scope="col" class="ptr-add-col"><button type="button" class="ptr-add" data-add-questions title="Ajouter des questions (colonnes)">+ Question</button></th>
        </tr></thead>
        <tbody>${ordered.map(({ row, index }) => `
          <tr>
            <td><div class="ptr-th-sortable"><div style="min-width:0"><div class="ptr-row-label">${escapeHtml(row.label)}</div><div class="ptr-row-docs" title="${escapeHtml(row.documents.join('\n'))}">${escapeHtml(row.documents.map(basename).join(' · '))}</div></div><button type="button" class="ptr-icon-button" data-remove-row="${index}" aria-label="Retirer la ligne">×</button></div></td>
            ${columns.map(() => '<td><span class="ptr-muted">—</span></td>').join('')}
            <td class="ptr-add-col"></td>
          </tr>`).join('')}
          <tr><td><button type="button" class="ptr-add" data-add-documents title="Ajouter des documents (lignes)">+ Documents</button></td><td colspan="${columns.length + 1}"></td></tr>
        </tbody>
      </table>`;
  }

  function renderFooter() {
    $('[data-filename]').textContent = `${REVIEW_FOLDER}/${filenamePreview(templateName, title)}`;
    $<HTMLButtonElement>('[data-launch]').disabled = launching || !columns.length || !rows.length || !modelSelect.value;
    $<HTMLButtonElement>('[data-launch]').textContent = launching ? 'Lancement…' : 'Lancer l’analyse tabulaire';
    const costly = modelSelect.value && modelSelect.value !== models.cheapest;
    $('[data-model-warning]').innerHTML = costly
      ? `<span class="ptr-warning" title="Chaque ligne lance une session IA complète (${rows.length} session${rows.length > 1 ? 's' : ''}).">Modèle coûteux en tokens</span>`
      : '';
  }

  let saving = Promise.resolve();
  function persist() {
    saving = saving.then(() => app.rpc('PUT', '/drafts', { draft: { id: draft.id, project, title, templateName, columns, rows } })).then(() => undefined, (error) => toast(app.root, `Projet non enregistré : ${errorMessage(error)}`, 'error'));
  }

  function renderAll() {
    renderNotice();
    renderTable();
    renderFooter();
  }

  async function loadProviderModels() {
    const provider = providerSelect.value as Provider;
    modelSelect.innerHTML = '<option value="">Chargement…</option>';
    try {
      models = await loadModels(provider);
    } catch {
      models = { options: provider === 'claude' ? [{ value: 'haiku', label: 'Haiku' }] : [], cheapest: provider === 'claude' ? 'haiku' : '' };
    }
    modelSelect.innerHTML = models.options.length
      ? models.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === models.cheapest ? ' selected' : ''}>${escapeHtml(option.label)}${option.value === models.cheapest ? ' (par défaut, économique)' : ''}</option>`).join('')
      : '<option value="">Aucun modèle disponible</option>';
    if (models.options.some((option) => option.value === preferredModel)) modelSelect.value = preferredModel;
    preferredModel = '';
    renderFooter();
  }

  function addQuestions() {
    openQuestionsDrawer(app, ({ columns: added, template }) => {
      const wasSorting = isSorting();
      const next = [...columns, ...added];
      templateName = template && !columns.length ? template.name : CUSTOM_TEMPLATE;
      columns = next;
      if (wasSorting !== isSorting() && rows.length) {
        rows = [];
        toast(app.root, 'Les questions de tri portent sur les pièces du dossier : ajoutez de nouveau les documents.');
      }
      persist();
      renderAll();
    });
  }

  function addDocuments() {
    openDocumentsDrawer(app, {
      project,
      sorting: isSorting(),
      existing: new Set(rows.flatMap((row) => row.documents)),
      onSubmit(added) {
        rows = [...rows, ...added];
        persist();
        renderAll();
      },
    });
  }

  async function launch() {
    if (!columns.length || !rows.length) return;
    const provider = providerSelect.value as Provider;
    const model = modelSelect.value;
    const costly = model !== models.cheapest;
    const sessions = rows.length;
    const confirmed = await confirmDialog(
      app.root,
      'Lancer l’analyse tabulaire ?',
      `<p>Vous allez lancer <strong>${sessions} session${sessions > 1 ? 's' : ''} IA</strong> (une par ligne) avec <strong>${escapeHtml(provider)} — ${escapeHtml(modelSelect.selectedOptions[0]?.textContent ?? model)}</strong>, chacune pour ${columns.length} question${columns.length > 1 ? 's' : ''}.</p>
       <p class="ptr-muted">Les documents sont copiés dans « ${escapeHtml(REVIEW_FOLDER)}/docs » du dossier et le résultat est enregistré dans « ${escapeHtml(filenamePreview(templateName, title))} ». Les sessions passent par le proxy d’anonymisation et n’apparaissent pas dans l’historique des sessions.</p>
       ${costly ? '<div class="ptr-warning">Attention : ce modèle consomme beaucoup de tokens.</div>' : ''}`,
      'Lancer',
    );
    if (!confirmed) return;
    launching = true;
    renderFooter();
    try {
      const proxyOrigin = await anonymizationProxyOrigin();
      const detail = await app.rpc<ReviewDetail>('POST', '/reviews', {
        project,
        templateName,
        columns,
        title,
        rows,
        provider,
        model,
        concurrency: Number(concurrencySelect.value),
        proxyOrigin,
      });
      await saving;
      await app.rpc('POST', '/drafts/delete', { id: draft.id }).catch(() => undefined);
      app.openReview(detail.project, detail.file);
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    } finally {
      launching = false;
      renderFooter();
    }
  }

  element.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const columnIndex = target.dataset.columnTitle ?? target.dataset.columnPrompt;
    if (columnIndex !== undefined && columns[Number(columnIndex)]) {
      const column = columns[Number(columnIndex)];
      const value = (target as HTMLInputElement).value.trim();
      if (target.dataset.columnPrompt !== undefined && !value) {
        (target as HTMLTextAreaElement).value = column.prompt;
        return;
      }
      columns[Number(columnIndex)] = target.dataset.columnTitle !== undefined ? { ...column, name: value || column.prompt.replace(/\s+/g, ' ').slice(0, 60) } : { ...column, prompt: value };
      if (target.dataset.columnPrompt !== undefined) templateName = CUSTOM_TEMPLATE;
      persist();
      return;
    }
    if (target === providerSelect) void loadProviderModels();
    else if (target === modelSelect) renderFooter();
  });

  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const sortKey = target.closest<HTMLElement>('[data-sort]')?.dataset.sort;
    if (target.closest('[data-back]')) onBack();
    else if (target.closest('[data-launch]')) void launch();
    else if (target.closest('[data-add-questions]')) addQuestions();
    else if (target.closest('[data-add-documents]')) addDocuments();
    else if (sortKey) {
      sort = nextSort(sort, sortKey);
      renderTable();
    } else if (target.closest('[data-remove-column]')) {
      columns.splice(Number(target.closest<HTMLElement>('[data-remove-column]')!.dataset.removeColumn), 1);
      if (!columns.length) templateName = CUSTOM_TEMPLATE;
      persist();
      renderAll();
    } else if (target.closest('[data-remove-row]')) {
      rows.splice(Number(target.closest<HTMLElement>('[data-remove-row]')!.dataset.removeRow), 1);
      persist();
      renderAll();
    }
  });

  renderAll();
  providerSelect.value = draft.provider ?? DEFAULT_PROVIDER;
  void loadProviderModels();
  void app.rpc<{ projects: string[] }>('GET', '/protected-projects').then((result) => {
    protectedProject = result.projects.includes(project);
    renderNotice();
  }).catch(() => undefined);

  return {
    element,
    destroy() {},
  };
}
