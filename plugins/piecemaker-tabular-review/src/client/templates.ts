import type { ColumnAction, ColumnFormat, Template, TemplateColumn } from '../shared.js';
import { COLUMN_ACTIONS, COLUMN_FORMATS } from '../shared.js';
import type { App, View } from './app.js';
import { confirmDialog, errorMessage, escapeHtml, formatDate, openModal, toast } from './dom.js';

const FORMAT_DESCRIPTIONS: Record<ColumnFormat, string> = {
  text: 'Réponse rédigée concise.',
  list: 'Une puce par élément.',
  date: 'JJ/MM/AAAA ou une période.',
  amount: 'Montant avec devise, HT/TTC si précisé.',
  yes_no: 'Oui ou Non, avec une brève précision.',
  tags: 'Étiquettes séparées par des virgules, parmi celles autorisées si définies.',
};

export type DraftColumn = TemplateColumn & { tagsText: string };

export function draftColumns(template: Template | null): DraftColumn[] {
  const columns = template?.columns.length ? template.columns : [{ name: '', prompt: '', format: 'text' as ColumnFormat }];
  return columns.map((column) => ({ ...column, tagsText: (column.tags ?? []).join(', ') }));
}

export function questionHtml(column: DraftColumn, index: number, count: number): string {
  return `
    <div class="ptr-question" data-question="${index}">
      <input class="ptr-input" data-field="name" value="${escapeHtml(column.name)}" placeholder="Titre de la colonne (ex. Durée du préavis)" aria-label="Titre de la question ${index + 1}" maxlength="120">
      <select class="ptr-select" data-field="format" aria-label="Format de la réponse">
        ${COLUMN_FORMATS.map((format) => `<option value="${format.value}"${format.value === column.format ? ' selected' : ''}>${escapeHtml(format.label)} — ${escapeHtml(FORMAT_DESCRIPTIONS[format.value])}</option>`).join('')}
      </select>
      <select class="ptr-select" data-field="action" aria-label="Action appliquée à la pièce" title="Une réponse « Renommer » ou « Ranger » s’applique à la pièce avec le bouton « Appliquer » de la review">
        <option value="">Aucune action</option>
        ${COLUMN_ACTIONS.map((action) => `<option value="${action.value}"${action.value === column.action ? ' selected' : ''}>${escapeHtml(action.label)}</option>`).join('')}
      </select>
      <div class="ptr-question-actions">
        <button type="button" class="ptr-icon-button" data-move="-1" aria-label="Monter la question"${index === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="ptr-icon-button" data-move="1" aria-label="Descendre la question"${index === count - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="ptr-icon-button" data-remove aria-label="Supprimer la question"${count === 1 ? ' disabled' : ''}>✕</button>
      </div>
      ${column.action === 'custom' ? `<textarea class="ptr-textarea" data-field="customAction" rows="2" maxlength="4000" placeholder="Décrivez l’action souhaitée…" aria-label="Action personnalisée">${escapeHtml(column.customAction ?? '')}</textarea>` : ''}
      <textarea class="ptr-textarea" data-field="prompt" rows="2" placeholder="Consigne donnée à l’IA (ex. Quelle est la durée du préavis de résiliation ?)" aria-label="Consigne de la question ${index + 1}">${escapeHtml(column.prompt)}</textarea>
      ${column.format === 'tags' ? `<input class="ptr-input" data-tags-field data-field="tagsText" value="${escapeHtml(column.tagsText)}" placeholder="Étiquettes autorisées, séparées par des virgules" aria-label="Étiquettes autorisées">` : ''}
    </div>`;
}

async function editTemplate(app: App, template: Template | null, duplicate = false): Promise<void> {
  const isExisting = Boolean(template && !duplicate);
  let name = template ? (duplicate ? `${template.name} (copie)` : template.name) : '';
  let description = template?.description ?? '';
  let columns = draftColumns(template);
  let selectedIndex = 0;
  const actions: { label: string; value: string; kind?: 'primary' | 'danger' }[] = [];
  if (isExisting) actions.push({ label: 'Supprimer', value: 'delete', kind: 'danger' }, { label: 'Dupliquer', value: 'duplicate' });
  actions.push({ label: 'Annuler', value: 'cancel' }, { label: 'Enregistrer', value: 'save', kind: 'primary' });

  const renderList = (dialog: HTMLElement) => {
    dialog.querySelector<HTMLElement>('[data-question-list]')!.innerHTML = columns.map((column, index) => `
      <button type="button" class="ptr-template-row" data-select-question="${index}" role="option" aria-selected="${index === selectedIndex}" tabindex="${index === selectedIndex ? 0 : -1}">
        <span class="ptr-template-number">${index + 1}</span>
        <span class="ptr-template-name">${escapeHtml(column.name || 'Nouvelle question')}</span>
        <span class="ptr-chip">${escapeHtml(COLUMN_FORMATS.find((format) => format.value === column.format)?.label)}</span>
      </button>`).join('');
    dialog.querySelector<HTMLElement>('[data-question-count]')!.textContent = `Questions (${columns.length})`;
    dialog.querySelector<HTMLButtonElement>('[data-move="-1"]')!.disabled = selectedIndex === 0;
    dialog.querySelector<HTMLButtonElement>('[data-move="1"]')!.disabled = selectedIndex === columns.length - 1;
  };

  const renderEditor = (dialog: HTMLElement) => {
    const column = columns[selectedIndex];
    dialog.querySelector<HTMLElement>('[data-question-editor]')!.innerHTML = `
      <div class="ptr-field"><div class="ptr-template-field-heading"><label class="ptr-label" for="ptr-template-column-name">Nom</label><button type="button" class="ptr-icon-button" data-remove aria-label="Supprimer la question"${columns.length === 1 ? ' disabled' : ''}>×</button></div><input id="ptr-template-column-name" class="ptr-input" data-field="name" value="${escapeHtml(column.name)}" placeholder="ex. Durée du préavis" maxlength="120"></div>
      <label class="ptr-field"><span class="ptr-label">Type</span><select class="ptr-select" data-field="format">
        ${COLUMN_FORMATS.map((format) => `<option value="${format.value}"${format.value === column.format ? ' selected' : ''}>${escapeHtml(format.label)} — ${escapeHtml(FORMAT_DESCRIPTIONS[format.value])}</option>`).join('')}
      </select></label>
      <label class="ptr-field"><span class="ptr-label">Action</span><select class="ptr-select" data-field="action" title="Une réponse « Renommer » ou « Ranger » s’applique à la pièce avec le bouton « Appliquer » de la review">
        <option value="">Aucune action</option>
        ${COLUMN_ACTIONS.map((action) => `<option value="${action.value}"${action.value === column.action ? ' selected' : ''}>${escapeHtml(action.label)}</option>`).join('')}
      </select></label>
      ${column.action === 'custom' ? `<label class="ptr-field"><span class="ptr-label">Action personnalisée</span><textarea class="ptr-textarea" data-field="customAction" rows="2" maxlength="4000" placeholder="Décrivez l’action souhaitée…">${escapeHtml(column.customAction ?? '')}</textarea></label>` : ''}
      <label class="ptr-field"><span class="ptr-label">Question / consigne</span><textarea class="ptr-textarea" data-field="prompt" rows="5" placeholder="Quelle information l’IA doit-elle extraire ?">${escapeHtml(column.prompt)}</textarea></label>
      ${column.format === 'tags' ? `<label class="ptr-field"><span class="ptr-label">Étiquettes autorisées</span><input class="ptr-input" data-field="tagsText" value="${escapeHtml(column.tagsText)}" placeholder="Séparées par des virgules"></label>` : ''}`;
  };

  const renderQuestions = (dialog: HTMLElement) => {
    renderList(dialog);
    renderEditor(dialog);
  };

  for (;;) {
    const answer = await openModal(app.root, {
      title: isExisting ? 'Modifier le modèle' : duplicate ? 'Dupliquer le modèle' : 'Nouveau modèle',
      wide: true,
      body: `
        <label class="ptr-field"><span class="ptr-label">Nom</span><input class="ptr-input" data-template-name maxlength="120" value="${escapeHtml(name)}" placeholder="ex. Baux commerciaux"></label>
        <label class="ptr-field"><span class="ptr-label">Description</span><textarea class="ptr-textarea" data-template-description rows="2" maxlength="500" placeholder="À quoi sert ce modèle ?">${escapeHtml(description)}</textarea></label>
        <div class="ptr-template-workspace">
          <section class="ptr-template-questions">
            <div class="ptr-template-list-header"><span class="ptr-label" data-question-count></span><button type="button" class="ptr-button" data-add-question>+ Ajouter une question</button></div>
            <div class="ptr-template-list">
              <div class="ptr-template-columns" aria-hidden="true"><span>#</span><span>Nom</span><span>Type</span></div>
              <div class="ptr-template-rows" data-question-list role="listbox" aria-label="Questions du modèle"></div>
              <div class="ptr-template-list-footer"><span>1 élément sélectionné</span><span class="ptr-spacer"></span><button type="button" class="ptr-icon-button" data-move="-1" aria-label="Monter la question">↑</button><button type="button" class="ptr-icon-button" data-move="1" aria-label="Descendre la question">↓</button></div>
            </div>
          </section>
          <section class="ptr-template-detail" data-question-editor aria-label="Question sélectionnée"></section>
        </div>`,
      actions,
      onMount(dialog) {
        dialog.classList.add('ptr-template-modal');
        renderQuestions(dialog);
        dialog.addEventListener('input', (event) => {
          const field = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          if (field.hasAttribute('data-template-name')) name = field.value;
          if (field.hasAttribute('data-template-description')) description = field.value;
          const key = field.dataset.field;
          const column = columns[selectedIndex];
          if (key === 'format') {
            column.format = field.value as ColumnFormat;
            renderQuestions(dialog);
            dialog.querySelector<HTMLSelectElement>('[data-field="format"]')?.focus();
          } else if (key === 'action') {
            column.action = (field.value || undefined) as ColumnAction | undefined;
            renderEditor(dialog);
            dialog.querySelector<HTMLSelectElement>('[data-field="action"]')?.focus();
          } else if (key === 'name' || key === 'prompt' || key === 'tagsText' || key === 'customAction') {
            column[key] = field.value;
            if (key === 'name') {
              renderList(dialog);
            }
          }
        });
        dialog.addEventListener('keydown', (event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>('[data-select-question]');
          if (!row || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          selectedIndex = event.key === 'Home' ? 0 : event.key === 'End' ? columns.length - 1 : Math.max(0, Math.min(columns.length - 1, selectedIndex + (event.key === 'ArrowUp' ? -1 : 1)));
          renderQuestions(dialog);
          dialog.querySelector<HTMLElement>(`[data-select-question="${selectedIndex}"]`)?.focus();
        });
        dialog.addEventListener('click', (event) => {
          const target = event.target as HTMLElement;
          if (target.closest('[data-add-question]')) {
            columns.push({ name: '', prompt: '', format: 'text', tagsText: '' });
            selectedIndex = columns.length - 1;
            renderQuestions(dialog);
            dialog.querySelector<HTMLInputElement>('[data-field="name"]')?.focus();
            dialog.querySelector<HTMLElement>(`[data-select-question="${selectedIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
            return;
          }
          const row = target.closest<HTMLElement>('[data-select-question]');
          if (row) {
            selectedIndex = Number(row.dataset.selectQuestion);
            renderQuestions(dialog);
            dialog.querySelector<HTMLElement>(`[data-select-question="${selectedIndex}"]`)?.focus();
            return;
          }
          const move = target.closest<HTMLElement>('[data-move]');
          if (move) {
            const destination = selectedIndex + Number(move.dataset.move);
            if (destination < 0 || destination >= columns.length) return;
            [columns[selectedIndex], columns[destination]] = [columns[destination], columns[selectedIndex]];
            selectedIndex = destination;
            renderQuestions(dialog);
          } else if (target.closest('[data-remove]') && columns.length > 1) {
            columns.splice(selectedIndex, 1);
            selectedIndex = Math.min(selectedIndex, columns.length - 1);
            renderQuestions(dialog);
          }
        });
      },
    });
    if (answer === 'duplicate' && template) return editTemplate(app, template, true);
    if (answer === 'delete' && template) {
      const confirmed = await confirmDialog(app.root, 'Supprimer le modèle ?', `<p>Le modèle « ${escapeHtml(template.name)} » sera supprimé. Les analyses tabulaires déjà lancées ne sont pas affectées.</p>`, 'Supprimer', true);
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
        ...(column.action ? { action: column.action } : {}),
        ...(column.action === 'custom' ? { customAction: column.customAction?.trim() ?? '' } : {}),
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
