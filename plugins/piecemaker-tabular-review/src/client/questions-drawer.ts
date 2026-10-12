import type { ColumnFormat, Template, TemplateColumn } from '../shared.js';
import { COLUMN_FORMATS } from '../shared.js';
import type { App } from './app.js';
import { escapeHtml, errorMessage, toast } from './dom.js';
import { openDrawer } from './drawer.js';

export type QuestionsResult = { columns: TemplateColumn[]; template: Template | null };

type Draft = TemplateColumn & { tagsText: string };

const blank = (): Draft => ({ name: '', prompt: '', format: 'text', tagsText: '' });

export function openQuestionsDrawer(app: App, onSubmit: (result: QuestionsResult) => Promise<void> | void): void {
  let drafts: Draft[] = [blank()];
  let templates: Template[] = [];
  let template: Template | null = null;
  let saving = false;
  const drawer = openDrawer(app.root, 'Ajouter des questions');
  drawer.element.classList.add('ptr-drawer-wide');
  drawer.body.innerHTML = `
    <div class="ptr-drawer-toolbar">
      <label class="ptr-field" style="flex:1"><span class="ptr-label">Partir d’un modèle</span><select class="ptr-select" data-template-pick><option value="">Chargement…</option></select></label>
      <button type="button" class="ptr-button" data-template-insert>Insérer ses questions</button>
    </div>
    <div class="ptr-question-table">
      <div class="ptr-question-head" aria-hidden="true"><span>#</span><span>Type</span><span>Question</span><span>Action</span></div>
      <div data-question-rows></div>
    </div>
    <div><button type="button" class="ptr-button" data-question-add>+ Ajouter une question</button></div>
    <div class="ptr-drawer-footer"><span class="ptr-spacer"></span><button type="button" class="ptr-button" data-drawer-close>Annuler</button><button type="button" class="ptr-button ptr-button-primary" data-question-submit>Enregistrer</button></div>`;
  const rows = drawer.body.querySelector<HTMLElement>('[data-question-rows]')!;
  const pick = drawer.body.querySelector<HTMLSelectElement>('[data-template-pick]')!;

  function render() {
    rows.innerHTML = drafts.map((draft, index) => `
      <div class="ptr-question-line" data-line="${index}">
        <span class="ptr-template-number">${index + 1}</span>
        <select class="ptr-select" data-field="format" aria-label="Type de la question ${index + 1}">${COLUMN_FORMATS.map((format) => `<option value="${format.value}"${format.value === draft.format ? ' selected' : ''}>${escapeHtml(format.label)}</option>`).join('')}</select>
        <div class="ptr-question-texts">
          <input class="ptr-input" data-field="name" value="${escapeHtml(draft.name)}" maxlength="120" placeholder="Titre (facultatif)" aria-label="Titre de la question ${index + 1}">
          <textarea class="ptr-textarea" data-field="prompt" rows="2" maxlength="4000" placeholder="Question posée à l’IA" aria-label="Question ${index + 1}">${escapeHtml(draft.prompt)}</textarea>
          ${draft.format === 'tags' ? `<input class="ptr-input" data-field="tagsText" value="${escapeHtml(draft.tagsText)}" placeholder="Étiquettes autorisées, séparées par des virgules" aria-label="Étiquettes autorisées">` : ''}
        </div>
        <button type="button" class="ptr-icon-button" data-question-remove aria-label="Supprimer la question ${index + 1}">🗑</button>
      </div>`).join('') || '<div class="ptr-empty">Aucune question.</div>';
  }

  function renderTemplates() {
    pick.innerHTML = templates.length
      ? templates.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)} — ${entry.columns.length} question${entry.columns.length > 1 ? 's' : ''}</option>`).join('')
      : '<option value="">Aucun modèle — créez-en un dans l’onglet Modèles</option>';
  }

  function insertTemplate() {
    const chosen = templates.find((entry) => entry.id === pick.value);
    if (!chosen) return;
    template = chosen;
    const kept = drafts.filter((draft) => draft.prompt.trim() || draft.name.trim());
    drafts = [...kept, ...chosen.columns.map((column) => ({ ...column, tagsText: (column.tags ?? []).join(', ') }))];
    render();
  }

  async function submit() {
    const filled = drafts.filter((draft) => draft.prompt.trim());
    if (!filled.length) {
      toast(app.root, 'Écrivez au moins une question.', 'error');
      return;
    }
    const columns: TemplateColumn[] = filled.map(({ tagsText, ...column }) => {
      const name = column.name.trim() || column.prompt.trim().replace(/\s+/g, ' ').slice(0, 60);
      const tags = tagsText.split(',').map((tag) => tag.trim()).filter(Boolean);
      return { ...column, name, prompt: column.prompt.trim(), ...(column.format === 'tags' && tags.length ? { tags } : { tags: undefined }) };
    });
    const fromTemplate = template && columns.length === template.columns.length && columns.every((column, index) => column.prompt === template!.columns[index].prompt) ? template : null;
    saving = true;
    drawer.body.querySelector<HTMLButtonElement>('[data-question-submit]')!.disabled = true;
    try {
      await onSubmit({ columns, template: fromTemplate });
      drawer.close();
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    } finally {
      saving = false;
      drawer.body.querySelector<HTMLButtonElement>('[data-question-submit]')!.disabled = false;
    }
  }

  drawer.body.addEventListener('input', (event) => {
    const field = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const draft = drafts[Number(field.closest<HTMLElement>('[data-line]')?.dataset.line)];
    const key = field.dataset.field as keyof Draft | undefined;
    if (!draft || !key) return;
    if (key === 'format') {
      draft.format = field.value as ColumnFormat;
      render();
    } else (draft as Record<string, unknown>)[key] = field.value;
  });
  drawer.body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-template-insert]')) insertTemplate();
    else if (target.closest('[data-question-add]')) {
      drafts.push(blank());
      render();
      rows.querySelector<HTMLTextAreaElement>('[data-line]:last-child [data-field="prompt"]')?.focus();
    } else if (target.closest('[data-question-remove]')) {
      drafts.splice(Number(target.closest<HTMLElement>('[data-line]')?.dataset.line), 1);
      render();
    } else if (target.closest('[data-question-submit]') && !saving) void submit();
  });

  render();
  void app.templates().then((loaded) => {
    templates = loaded;
    renderTemplates();
  }).catch((error) => {
    pick.innerHTML = '<option value="">Modèles indisponibles</option>';
    toast(app.root, errorMessage(error), 'error');
  });
}
