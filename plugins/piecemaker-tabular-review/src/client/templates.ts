import type { ColumnFormat, Template, TemplateColumn } from '../shared.js';
import { COLUMN_FORMATS } from '../shared.js';
import type { App, View } from './app.js';
import { confirmDialog, errorMessage, escapeHtml, formatDate, openModal, toast } from './dom.js';

type DraftColumn = TemplateColumn & { tagsText: string };

function draftColumns(template: Template | null): DraftColumn[] {
  const columns = template?.columns.length ? template.columns : [{ name: '', prompt: '', format: 'text' as ColumnFormat }];
  return columns.map((column) => ({ ...column, tagsText: (column.tags ?? []).join(', ') }));
}

function questionHtml(column: DraftColumn, index: number, count: number): string {
  return `
    <div class="ptr-question" data-question="${index}">
      <input class="ptr-input" data-field="name" value="${escapeHtml(column.name)}" placeholder="Titre de la colonne (ex. Durée du préavis)" aria-label="Titre de la question ${index + 1}" maxlength="120">
      <select class="ptr-select" data-field="format" aria-label="Format de la réponse">
        ${COLUMN_FORMATS.map((format) => `<option value="${format.value}"${format.value === column.format ? ' selected' : ''}>${escapeHtml(format.label)}</option>`).join('')}
      </select>
      <div class="ptr-question-actions">
        <button type="button" class="ptr-icon-button" data-move="-1" aria-label="Monter la question"${index === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="ptr-icon-button" data-move="1" aria-label="Descendre la question"${index === count - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="ptr-icon-button" data-remove aria-label="Supprimer la question"${count === 1 ? ' disabled' : ''}>✕</button>
      </div>
      <textarea class="ptr-textarea" data-field="prompt" rows="2" placeholder="Consigne donnée à l’IA (ex. Quelle est la durée du préavis de résiliation ?)" aria-label="Consigne de la question ${index + 1}">${escapeHtml(column.prompt)}</textarea>
      ${column.format === 'tags' ? `<input class="ptr-input" data-tags-field data-field="tagsText" value="${escapeHtml(column.tagsText)}" placeholder="Étiquettes autorisées, séparées par des virgules" aria-label="Étiquettes autorisées">` : ''}
    </div>`;
}

async function editTemplate(app: App, template: Template | null, duplicate = false): Promise<void> {
  const isExisting = Boolean(template && !duplicate);
  let name = template ? (duplicate ? `${template.name} (copie)` : template.name) : '';
  let description = template?.description ?? '';
  let columns = draftColumns(template);
  const actions: { label: string; value: string; kind?: 'primary' | 'danger' }[] = [];
  if (isExisting) actions.push({ label: 'Supprimer', value: 'delete', kind: 'danger' }, { label: 'Dupliquer', value: 'duplicate' });
  actions.push({ label: 'Annuler', value: 'cancel' }, { label: 'Enregistrer', value: 'save', kind: 'primary' });

  const renderQuestions = (dialog: HTMLElement) => {
    dialog.querySelector<HTMLElement>('[data-questions]')!.innerHTML = columns.map((column, index) => questionHtml(column, index, columns.length)).join('');
    dialog.querySelector<HTMLElement>('[data-question-count]')!.textContent = `Questions (${columns.length})`;
  };

  for (;;) {
    const answer = await openModal(app.root, {
      title: isExisting ? 'Modifier le modèle' : duplicate ? 'Dupliquer le modèle' : 'Nouveau modèle',
      wide: true,
      body: `
        <label class="ptr-field"><span class="ptr-label">Nom</span><input class="ptr-input" data-template-name maxlength="120" value="${escapeHtml(name)}" placeholder="ex. Baux commerciaux"></label>
        <label class="ptr-field"><span class="ptr-label">Description</span><textarea class="ptr-textarea" data-template-description rows="2" maxlength="500" placeholder="À quoi sert ce modèle ?">${escapeHtml(description)}</textarea></label>
        <div style="display:flex;align-items:center;gap:8px"><span class="ptr-label" data-question-count></span><span class="ptr-spacer"></span><button type="button" class="ptr-button" data-add-question>+ Ajouter une question</button></div>
        <div data-questions style="display:flex;flex-direction:column;gap:8px"></div>`,
      actions,
      onMount(dialog) {
        renderQuestions(dialog);
        dialog.addEventListener('input', (event) => {
          const field = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          if (field.hasAttribute('data-template-name')) name = field.value;
          if (field.hasAttribute('data-template-description')) description = field.value;
          const index = Number(field.closest<HTMLElement>('[data-question]')?.dataset.question);
          const key = field.dataset.field;
          const column = columns[index];
          if (!column) return;
          if (key === 'format') {
            column.format = field.value as ColumnFormat;
            renderQuestions(dialog);
          } else if (key === 'name' || key === 'prompt' || key === 'tagsText') {
            column[key] = field.value;
          }
        });
        dialog.addEventListener('click', (event) => {
          const target = event.target as HTMLElement;
          if (target.closest('[data-add-question]')) {
            columns.push({ name: '', prompt: '', format: 'text', tagsText: '' });
            renderQuestions(dialog);
            dialog.querySelector<HTMLInputElement>(`[data-question="${columns.length - 1}"] [data-field="name"]`)?.focus();
            return;
          }
          const index = Number(target.closest<HTMLElement>('[data-question]')?.dataset.question);
          if (!columns[index]) return;
          const move = target.closest<HTMLElement>('[data-move]');
          if (move) {
            const destination = index + Number(move.dataset.move);
            if (destination < 0 || destination >= columns.length) return;
            [columns[index], columns[destination]] = [columns[destination], columns[index]];
            renderQuestions(dialog);
          } else if (target.closest('[data-remove]') && columns.length > 1) {
            columns = columns.filter((_, position) => position !== index);
            renderQuestions(dialog);
          }
        });
      },
    });
    if (answer === 'duplicate' && template) return editTemplate(app, template, true);
    if (answer === 'delete' && template) {
      const confirmed = await confirmDialog(app.root, 'Supprimer le modèle ?', `<p>Le modèle « ${escapeHtml(template.name)} » sera supprimé. Les tabular reviews déjà lancées ne sont pas affectées.</p>`, 'Supprimer', true);
      if (!confirmed) continue;
      try {
        const result = await app.rpc<{ templates: Template[] }>('DELETE', `/templates?id=${encodeURIComponent(template.id)}`);
        app.setTemplates(result.templates);
        toast(app.root, 'Modèle supprimé.');
      } catch (error) {
        toast(app.root, errorMessage(error), 'error');
      }
      return;
    }
    if (answer !== 'save') return;
    const payload = {
      ...(isExisting && template ? { id: template.id } : {}),
      name: name.trim(),
      description: description.trim(),
      columns: columns.map((column) => ({
        name: column.name.trim(),
        prompt: column.prompt.trim(),
        format: column.format,
        ...(column.format === 'tags' ? { tags: column.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
      })),
    };
    try {
      const result = await app.rpc<{ templates: Template[] }>('PUT', '/templates', { template: payload });
      app.setTemplates(result.templates);
      toast(app.root, 'Modèle enregistré.');
      return;
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    }
  }
}

export function createTemplatesView(app: App): View {
  const element = document.createElement('div');
  element.className = 'ptr-page';
  element.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span class="ptr-muted">Chaque modèle définit les colonnes (questions) posées à l’IA pour chaque document.</span>
      <span class="ptr-spacer"></span>
      <button type="button" class="ptr-button ptr-button-primary" data-new>Nouveau modèle</button>
    </div>
    <div data-list><div class="ptr-empty"><span class="ptr-spinner"></span> Chargement…</div></div>`;
  const list = element.querySelector<HTMLElement>('[data-list]')!;
  let templates: Template[] = [];

  function render() {
    if (!templates.length) {
      list.innerHTML = '<div class="ptr-empty">Aucun modèle. Créez-en un avec « Nouveau modèle ».</div>';
      return;
    }
    list.innerHTML = `<div class="ptr-list">${templates.map((template) => `
      <div class="ptr-list-row" data-template="${escapeHtml(template.id)}" title="${escapeHtml(template.columns.map((column) => column.name).join(' · '))}">
        <button type="button" class="ptr-icon-button" data-menu aria-label="Modifier le modèle ${escapeHtml(template.name)}">⋮</button>
        <strong>${escapeHtml(template.name)}</strong>
        <span class="ptr-ellipsis ptr-muted">${escapeHtml(template.description || template.columns.map((column) => column.name).join(' · '))}</span>
        <span class="ptr-chip">${template.columns.length} question${template.columns.length > 1 ? 's' : ''}</span>
        <span class="ptr-small ptr-muted">${escapeHtml(formatDate(template.updatedAt))}</span>
      </div>`).join('')}</div>`;
  }

  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-new]')) {
      void editTemplate(app, null);
      return;
    }
    const row = target.closest<HTMLElement>('[data-template]');
    const template = templates.find((entry) => entry.id === row?.dataset.template);
    if (template) void editTemplate(app, template);
  });

  const stop = app.onTemplatesChange((next) => {
    templates = next;
    render();
  });

  app.templates().then((loaded) => {
    templates = loaded;
    render();
  }).catch((error: unknown) => {
    list.innerHTML = `<div class="ptr-error-box">${escapeHtml(errorMessage(error))}</div>`;
  });

  return {
    element,
    destroy() {
      stop();
    },
  };
}
