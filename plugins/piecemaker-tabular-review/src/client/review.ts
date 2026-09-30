import type { ExportFormat, ExportResult, ReviewDetail, ReviewRow } from '../shared.js';
import { FLAG_LABELS, FLAGS, REVIEW_FOLDER, reviewStatusLabel } from '../shared.js';
import type { App, View } from './app.js';
import { confirmDialog, errorMessage, escapeHtml, flagDot, formatDate, downloadBase64, renderMarkdown, toast } from './dom.js';
import { anonymizationProxyOrigin } from './host.js';

const POLL_INTERVAL = 2500;

const MIME_TYPES: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

function rowStatus(row: ReviewRow): string {
  switch (row.status) {
    case 'pending':
      return '<div class="ptr-row-status">En attente</div>';
    case 'running':
      return '<div class="ptr-row-status"><span class="ptr-spinner"></span> Analyse en cours…</div>';
    case 'error':
      return `<div class="ptr-row-status ptr-status-error">Erreur : ${escapeHtml(row.error ?? 'session IA en échec')}</div>`;
    case 'cancelled':
      return '<div class="ptr-row-status ptr-status-error">Annulée</div>';
    default:
      return '';
  }
}

export function createReviewView(app: App, project: string, file: string, onBack: () => void): View {
  const element = document.createElement('div');
  element.className = 'ptr-review';
  element.innerHTML = '<div class="ptr-empty"><span class="ptr-spinner"></span> Chargement…</div>';
  let detail: ReviewDetail | null = null;
  let selected: { row: string; column: number } | null = null;
  let timer = 0;
  let destroyed = false;
  let busy = false;
  let scroll = { top: 0, left: 0 };

  function renderDetail(): string {
    if (!detail || !selected) return '';
    const { review } = detail;
    const row = review.rows.find((entry) => entry.id === selected!.row);
    const column = review.columns.find((entry) => entry.index === selected!.column);
    if (!row || !column) return '';
    const cell = review.cells[row.id]?.[String(column.index)];
    return `
      <aside class="ptr-detail" aria-label="Détail de la cellule">
        <div style="display:flex;align-items:flex-start;gap:6px"><h3 style="flex:1">${escapeHtml(column.name)}</h3><button type="button" class="ptr-icon-button" data-close-detail aria-label="Fermer le détail">×</button></div>
        <div class="ptr-small ptr-muted">${escapeHtml(row.label)}</div>
        <div><div class="ptr-label">Question</div><div class="ptr-md">${renderMarkdown(column.prompt)}</div></div>
        ${cell ? `
          <div><div class="ptr-label">Réponse</div><div style="display:flex;gap:6px">${flagDot(cell.flag)}<div class="ptr-md">${renderMarkdown(cell.summary)}</div></div><div class="ptr-small ptr-muted">${escapeHtml(FLAG_LABELS[cell.flag])}</div></div>
          <div><div class="ptr-label">Justification</div><div class="ptr-md">${cell.reasoning ? renderMarkdown(cell.reasoning) : '<p class="ptr-muted">—</p>'}</div></div>`
          : `<div class="ptr-muted">${row.status === 'done' ? 'Aucune réponse.' : 'Pas encore de réponse pour cette cellule.'}</div>${rowStatus(row)}`}
        <div><div class="ptr-label">Documents</div><ul class="ptr-summary-list">${row.documents.map((document) => `<li title="${escapeHtml(document.copy)}">${escapeHtml(document.source)}</li>`).join('')}</ul></div>
      </aside>`;
  }

  function render() {
    if (!detail) return;
    const { review, status } = detail;
    const wrap = element.querySelector<HTMLElement>('.ptr-table-wrap');
    if (wrap) scroll = { top: wrap.scrollTop, left: wrap.scrollLeft };
    const done = review.rows.filter((row) => row.status === 'done').length;
    const failed = review.rows.some((row) => row.status === 'error' || row.status === 'cancelled') || status === 'interrupted';
    const running = status === 'running';
    element.innerHTML = `
      <div class="ptr-review-top">
        <button type="button" class="ptr-button" data-back>← Retour</button>
        <div style="min-width:0">
          <div class="ptr-review-title">${escapeHtml(review.title)}</div>
          <div class="ptr-small ptr-muted">${escapeHtml(review.templateName)} · ${escapeHtml(app.projectName(project))} · ${escapeHtml(review.provider)} ${escapeHtml(review.model)} · ${escapeHtml(formatDate(review.createdAt))}</div>
        </div>
        <span class="ptr-chip ptr-chip-${status}">${running ? '<span class="ptr-spinner"></span>' : ''}${escapeHtml(reviewStatusLabel(status))} · ${done}/${review.rows.length}</span>
        ${running ? `<div class="ptr-progress" aria-hidden="true"><div style="width:${review.rows.length ? Math.round((done / review.rows.length) * 100) : 0}%"></div></div>` : ''}
        <span class="ptr-spacer"></span>
        ${running ? '<button type="button" class="ptr-button ptr-button-danger" data-cancel>Annuler</button>' : ''}
        ${!running && failed ? '<button type="button" class="ptr-button" data-retry>Relancer les échecs</button>' : ''}
        <button type="button" class="ptr-button" data-export="docx">Export Word</button>
        <button type="button" class="ptr-button" data-export="pdf">Export PDF</button>
        ${app.api.openFileInEditor ? '<button type="button" class="ptr-button" data-open-json>Ouvrir le JSON</button>' : ''}
      </div>
      <div class="ptr-legend">${FLAGS.map((flag) => `<span>${flagDot(flag)}${escapeHtml(FLAG_LABELS[flag])}</span>`).join('')}</div>
      <div class="ptr-review-body">
        <div class="ptr-table-wrap">
          <table class="ptr-table">
            <thead><tr><th scope="col">Document</th>${review.columns.map((column) => `<th scope="col" title="${escapeHtml(column.prompt)}">${escapeHtml(column.name)}</th>`).join('')}</tr></thead>
            <tbody>${review.rows.map((row) => `
              <tr>
                <td><div class="ptr-row-label">${escapeHtml(row.label)}</div>${row.documents.length > 1 ? `<div class="ptr-row-status">${row.documents.length} documents</div>` : ''}${rowStatus(row)}</td>
                ${review.columns.map((column) => {
                  const cell = review.cells[row.id]?.[String(column.index)];
                  const isSelected = selected?.row === row.id && selected.column === column.index;
                  const content = cell
                    ? `<div class="ptr-cell-content">${flagDot(cell.flag)}<div class="ptr-md">${renderMarkdown(cell.summary)}</div></div>`
                    : row.status === 'running' ? '<span class="ptr-muted"><span class="ptr-spinner"></span></span>' : '<span class="ptr-muted">—</span>';
                  return `<td class="ptr-cell" tabindex="0" data-row="${escapeHtml(row.id)}" data-column="${column.index}" aria-selected="${isSelected}">${content}</td>`;
                }).join('')}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${renderDetail()}
      </div>`;
    const nextWrap = element.querySelector<HTMLElement>('.ptr-table-wrap');
    if (nextWrap) {
      nextWrap.scrollTop = scroll.top;
      nextWrap.scrollLeft = scroll.left;
    }
  }

  function schedule() {
    window.clearTimeout(timer);
    if (!destroyed && detail?.status === 'running') timer = window.setTimeout(() => void load(), POLL_INTERVAL);
  }

  async function load() {
    try {
      const next = await app.rpc<ReviewDetail>('GET', `/reviews/item?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`);
      if (destroyed) return;
      detail = next;
      render();
    } catch (error) {
      if (destroyed) return;
      if (!detail) {
        element.innerHTML = `<div class="ptr-review-top"><button type="button" class="ptr-button" data-back>← Retour</button></div><div class="ptr-error-box">${escapeHtml(errorMessage(error))}</div>`;
        return;
      }
      toast(app.root, errorMessage(error), 'error');
    }
    schedule();
  }

  async function action(run: () => Promise<void>) {
    if (busy) return;
    busy = true;
    element.querySelectorAll<HTMLButtonElement>('.ptr-review-top .ptr-button').forEach((button) => { button.disabled = true; });
    try {
      await run();
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    } finally {
      busy = false;
      if (!destroyed) render();
    }
  }

  const applyDetail = (next: ReviewDetail) => {
    detail = next;
    schedule();
  };

  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-back]')) {
      onBack();
      return;
    }
    if (target.closest('[data-close-detail]')) {
      selected = null;
      render();
      return;
    }
    if (target.closest('[data-cancel]')) {
      void action(async () => {
        if (!await confirmDialog(app.root, 'Annuler la tabular review ?', '<p>Les sessions IA en cours sont arrêtées ; les lignes déjà analysées sont conservées.</p>', 'Arrêter', true)) return;
        applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/cancel', { project, file }));
      });
      return;
    }
    if (target.closest('[data-retry]')) {
      void action(async () => {
        const proxyOrigin = await anonymizationProxyOrigin();
        applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/retry', { project, file, proxyOrigin }));
      });
      return;
    }
    const exportButton = target.closest<HTMLElement>('[data-export]');
    if (exportButton) {
      const format = exportButton.dataset.export as ExportFormat;
      void action(async () => {
        const result = await app.rpc<ExportResult>('POST', '/reviews/export', { project, file, format });
        downloadBase64(result.filename, result.base64, MIME_TYPES[format]);
        toast(app.root, `Export enregistré dans « ${REVIEW_FOLDER}/${result.filename} ».`);
      });
      return;
    }
    if (target.closest('[data-open-json]')) {
      app.api.openFileInEditor?.(`${project.replace(/[\\/]+$/, '')}/${REVIEW_FOLDER}/${file}`);
      return;
    }
    const cell = target.closest<HTMLElement>('td.ptr-cell');
    if (cell) {
      selected = { row: cell.dataset.row ?? '', column: Number(cell.dataset.column) };
      render();
    }
  });

  element.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && target.matches('td.ptr-cell')) {
      selected = { row: target.dataset.row ?? '', column: Number(target.dataset.column) };
      render();
      element.querySelector<HTMLElement>(`td.ptr-cell[data-row="${CSS.escape(selected.row)}"][data-column="${selected.column}"]`)?.focus();
    } else if (event.key === 'Escape' && selected) {
      selected = null;
      render();
    }
  });

  return {
    element,
    show() {
      void load();
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
    },
  };
}
