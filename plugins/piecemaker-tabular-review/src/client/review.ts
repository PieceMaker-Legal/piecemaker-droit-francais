import type { Cell, CitationSource, ExportFormat, ExportResult, Provider, ReviewDetail, ReviewRow } from '../shared.js';
import { CATEGORY_LABELS, citationIssue, lastSearchDate, emptyColumns, FLAG_LABELS, FLAGS, isCellFilled, MAX_CITATION_CORRECTIONS, REVIEW_FOLDER, reviewStatusLabel } from '../shared.js';
import type { App, View } from './app.js';
import { confirmDialog, errorMessage, escapeHtml, flagDot, formatDate, downloadBase64, openModal, renderMarkdown, toast } from './dom.js';
import { anonymizationProxyOrigin, loadModels } from './host.js';
import type { ModelOption } from './host.js';

const POLL_INTERVAL = 2500;

const MIME_TYPES: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'mistral', label: 'Mistral' },
];

function rowStatus(row: ReviewRow): string {
  switch (row.status) {
    case 'pending':
      return '<div class="ptr-row-status">En attente</div>';
    case 'running':
      return row.corrections
        ? `<div class="ptr-row-status"><span class="ptr-spinner"></span> Correction des citations (${row.corrections}/${MAX_CITATION_CORRECTIONS})…</div>`
        : '<div class="ptr-row-status"><span class="ptr-spinner"></span> Analyse en cours…</div>';
    case 'error':
      return `<div class="ptr-row-status ptr-status-error">Erreur : ${escapeHtml(row.error ?? 'session IA en échec')}</div>`;
    case 'cancelled':
      return '<div class="ptr-row-status ptr-status-error">Annulée</div>';
    default:
      return '';
  }
}

function citationLinks(cell: Cell): string {
  const links = (cell.citations ?? []).map((citation, index) => `<a href="#" class="ptr-cite${citation.verified ? '' : ' ptr-cite-ko'}" data-citation="${index}" title="${escapeHtml(`${citation.verified ? '' : 'Extrait non retrouvé dans la source — '}« ${citation.quote} » (${citation.document})`)}">[${index + 1}]</a>`);
  if (citationIssue(cell) === 'missing') links.push('<span class="ptr-cite ptr-cite-ko" title="Aucune citation fournie malgré les relances">sans citation</span>');
  return links.length ? `<div class="ptr-cites">${links.join('')}</div>` : '';
}

function citationList(cell: Cell): string {
  const citations = cell.citations ?? [];
  if (!citations.length) return citationIssue(cell) === 'missing' ? '<p class="ptr-status-error ptr-small">Aucune citation fournie malgré les relances.</p>' : '<p class="ptr-muted">—</p>';
  return `<ol class="ptr-citation-list">${citations.map((citation, index) => `
    <li><a href="#" class="ptr-citation-quote" data-citation="${index}">« ${escapeHtml(citation.quote)} »</a>
      <div class="ptr-small ${citation.verified ? 'ptr-muted' : 'ptr-status-error'}">${escapeHtml(citation.document)}${citation.verified ? '' : ' · extrait non retrouvé dans la source'}</div></li>`).join('')}</ol>`;
}

function sourceBody(source: CitationSource): string {
  let html = '';
  let cursor = 0;
  for (const range of [...source.ranges].sort((left, right) => left.start - right.start)) {
    if (range.start < cursor) continue;
    html += `${escapeHtml(source.text.slice(cursor, range.start))}<mark>${escapeHtml(source.text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  html += escapeHtml(source.text.slice(cursor));
  const partial = source.offset > 0 || source.offset + source.text.length < source.length;
  return `
    <div class="ptr-small ${source.verified ? 'ptr-muted' : 'ptr-status-error'}">${source.verified ? 'Extrait vérifié dans le document source.' : 'Extrait non retrouvé dans le document source.'}${partial ? ' Seule la partie du document autour de l’extrait est affichée.' : ''}</div>
    ${source.link ? `<div class="ptr-small"><a href="${escapeHtml(source.link)}" target="_blank" rel="noopener noreferrer">Ouvrir sur ${/courdecassation\.fr/.test(source.link) ? 'Judilibre' : 'Légifrance'}</a></div>` : ''}
    ${source.verified ? '' : `<blockquote class="ptr-citation-quote">« ${escapeHtml(source.quote)} »</blockquote>`}
    <div class="ptr-source-text">${html}</div>`;
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
  let choice: { provider: Provider; model: string } | null = null;
  let models: { provider: Provider; options: ModelOption[]; cheapest: string } | null = null;

  async function loadChoiceModels(provider: Provider) {
    try {
      models = { provider, ...await loadModels(provider) };
    } catch {
      models = { provider, options: [], cheapest: '' };
    }
    if (choice && !choice.model) choice.model = models.cheapest || models.options[0]?.value || '';
    if (!destroyed) render();
  }

  function modelSelector(running: boolean): string {
    if (!choice) return '';
    const options = models?.provider === choice.provider ? models.options : [];
    const listed = !choice.model || options.some((option) => option.value === choice!.model) ? options : [{ value: choice.model, label: choice.model }, ...options];
    return `
        <label class="ptr-field" style="width:110px"><span class="ptr-label">IA</span><select class="ptr-select" data-choice-provider${running ? ' disabled' : ''}>${PROVIDERS.map((provider) => `<option value="${provider.value}"${provider.value === choice!.provider ? ' selected' : ''}>${provider.label}</option>`).join('')}</select></label>
        <label class="ptr-field" style="width:200px"><span class="ptr-label">Modèle IA pour les relances</span><select class="ptr-select" data-choice-model${running ? ' disabled' : ''}>${listed.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === choice!.model ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
  }

  function costlyChoice(): string {
    return choice && models?.provider === choice.provider && models.cheapest && choice.model !== models.cheapest
      ? '<div class="ptr-warning">Attention : ce modèle consomme beaucoup de tokens.</div>'
      : '';
  }

  const choiceLabel = () => escapeHtml(choice ? `${choice.provider} — ${choice.model}` : '');
  const choiceBody = () => (choice?.model ? { provider: choice.provider, model: choice.model } : {});

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
          <div><div class="ptr-label">Justification</div><div class="ptr-md">${cell.reasoning ? renderMarkdown(cell.reasoning) : '<p class="ptr-muted">—</p>'}</div></div>
          <div><div class="ptr-label">Citations</div>${citationList(cell)}${row.corrections ? `<div class="ptr-small ptr-muted">${row.corrections} demande${row.corrections > 1 ? 's' : ''} de correction envoyée${row.corrections > 1 ? 's' : ''} à la session.</div>` : ''}</div>`
          : `<div class="ptr-muted">${row.status === 'done' ? 'Aucune réponse.' : 'Pas encore de réponse pour cette cellule.'}</div>${rowStatus(row)}`}
        <div><button type="button" class="ptr-button" data-run-cell>${isCellFilled(cell) ? 'Relancer cette cellule' : 'Lancer la session pour cette cellule'}</button></div>
        <div><div class="ptr-label">Documents</div><ul class="ptr-summary-list">${row.documents.map((document) => `<li title="${escapeHtml(document.copy)}">${/^https:\/\//.test(document.source) ? `<a href="${escapeHtml(document.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.source.replace(/^https:\/\/www\.legifrance\.gouv\.fr\/\w+\/id\//, 'Légifrance · ').replace(/^https:\/\/www\.courdecassation\.fr\/decision\//, 'Judilibre · '))}</a>` : escapeHtml(document.source)}</li>`).join('')}</ul></div>
      </aside>`;
  }

  function render() {
    if (!detail) return;
    const { review, status } = detail;
    if (!choice) {
      choice = { provider: review.provider, model: review.model };
      void loadChoiceModels(choice.provider);
    }
    const wrap = element.querySelector<HTMLElement>('.ptr-table-wrap');
    if (wrap) scroll = { top: wrap.scrollTop, left: wrap.scrollLeft };
    const done = review.rows.filter((row) => row.status === 'done').length;
    const failed = review.rows.some((row) => row.status === 'error' || row.status === 'cancelled' || emptyColumns(review, row.id).length > 0) || status === 'interrupted';
    const running = status === 'running';
    element.innerHTML = `
      <div class="ptr-review-top">
        <button type="button" class="ptr-button" data-back>← Retour</button>
        <div style="min-width:0">
          <div class="ptr-review-title">${escapeHtml(review.title)}</div>
          <div class="ptr-small ptr-muted">${escapeHtml(review.templateName)} · ${escapeHtml(app.projectName(project))} · ${escapeHtml(formatDate(review.createdAt))}</div>
          ${review.research ? `<div class="ptr-small ptr-muted" title="${escapeHtml(review.research.criteria.join('\n'))}">Requête : <code>${escapeHtml(review.research.query)}</code> · ${escapeHtml(review.research.criteria.join(' · '))} · dernière recherche le ${escapeHtml(formatDate(lastSearchDate(review)))}${review.research.updates?.length ? ` (${review.research.updates.length} mise${review.research.updates.length > 1 ? 's' : ''} à jour)` : ''}</div>` : ''}
        </div>
        ${review.category === 'recherche-juridique' ? `<span class="ptr-chip ptr-chip-category">${escapeHtml(CATEGORY_LABELS['recherche-juridique'])}</span>` : ''}
        <span class="ptr-chip ptr-chip-${status}">${running ? '<span class="ptr-spinner"></span>' : ''}${escapeHtml(reviewStatusLabel(status))} · ${done}/${review.rows.length}</span>
        ${running ? `<div class="ptr-progress" aria-hidden="true"><div style="width:${review.rows.length ? Math.round((done / review.rows.length) * 100) : 0}%"></div></div>` : ''}
        <span class="ptr-spacer"></span>
        ${modelSelector(running)}
        ${running ? '<button type="button" class="ptr-button ptr-button-danger" data-cancel>Annuler</button>' : ''}
        ${review.research ? `<button type="button" class="ptr-button" data-update-research${review.research.filters ? ` title="Chercher les décisions rendues depuis la dernière recherche (${escapeHtml(formatDate(lastSearchDate(review)))}) et les analyser"` : ' disabled title="Recherche lancée avant l’enregistrement de ses critères : relancez-la depuis l’onglet Recherche juridique"'}>Mettre à jour la recherche</button>` : ''}
        ${!running && failed ? '<button type="button" class="ptr-button" data-retry title="Relance les lignes en échec et complète les cellules vides">Relancer les échecs</button>' : ''}
        <button type="button" class="ptr-button" data-export="docx">Export Word</button>
        <button type="button" class="ptr-button" data-export="pdf">Export PDF</button>
        ${app.api.openFileInEditor ? '<button type="button" class="ptr-button" data-open-json>Ouvrir le JSON</button>' : ''}
      </div>
      <div class="ptr-legend">${FLAGS.map((flag) => `<span>${flagDot(flag)}${escapeHtml(FLAG_LABELS[flag])}</span>`).join('')}</div>
      <div class="ptr-review-body">
        <div class="ptr-table-wrap">
          <table class="ptr-table">
            <thead><tr><th scope="col">${review.category === 'recherche-juridique' ? 'Décision' : 'Document'}</th>${review.columns.map((column) => `<th scope="col" title="${escapeHtml(column.prompt)}"><div class="ptr-th">${escapeHtml(column.name)}<button type="button" class="ptr-icon-button" data-run-column="${column.index}" aria-label="Lancer les cellules vides de la colonne ${escapeHtml(column.name)}" title="Lancer les cellules vides de cette colonne">▶</button></div></th>`).join('')}</tr></thead>
            <tbody>${review.rows.map((row) => `
              <tr>
                <td><div class="ptr-row-label">${escapeHtml(row.label)}</div>${row.documents.length > 1 ? `<div class="ptr-row-status">${row.documents.length} documents</div>` : ''}${rowStatus(row)}</td>
                ${review.columns.map((column) => {
                  const cell = review.cells[row.id]?.[String(column.index)];
                  const isSelected = selected?.row === row.id && selected.column === column.index;
                  const content = cell
                    ? `<div class="ptr-cell-content">${flagDot(cell.flag)}<div class="ptr-md">${renderMarkdown(cell.summary)}</div></div>${citationLinks(cell)}`
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

  function openCitation(rowId: string, column: number, index: number) {
    const params = new URLSearchParams({ project, file, row: rowId, column: String(column), citation: String(index) });
    void openModal(app.root, {
      title: `Citation [${index + 1}]`,
      body: '<div class="ptr-empty"><span class="ptr-spinner"></span> Chargement de la source…</div>',
      wide: true,
      actions: [{ label: 'Fermer', value: 'close', kind: 'primary' }],
      onMount(dialog) {
        const body = dialog.querySelector<HTMLElement>('.ptr-modal-body')!;
        app.rpc<CitationSource>('GET', `/reviews/citation?${params}`).then((source) => {
          const title = dialog.querySelector<HTMLElement>('.ptr-modal-header h2');
          if (title) title.textContent = `Citation [${index + 1}] · ${source.document}`;
          body.innerHTML = sourceBody(source);
          body.querySelector('mark')?.scrollIntoView({ block: 'center' });
        }).catch((error: unknown) => {
          body.innerHTML = `<div class="ptr-error-box">${escapeHtml(errorMessage(error))}</div>`;
        });
      },
    });
  }

  const applyDetail = (next: ReviewDetail) => {
    detail = next;
    schedule();
  };

  element.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (!choice) return;
    if (target.matches('[data-choice-provider]')) {
      choice = { provider: (target as HTMLSelectElement).value as Provider, model: '' };
      void loadChoiceModels(choice.provider);
    } else if (target.matches('[data-choice-model]')) {
      choice.model = (target as HTMLSelectElement).value;
      render();
    }
  });

  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const citation = target.closest<HTMLElement>('[data-citation]');
    if (citation) {
      event.preventDefault();
      const host = citation.closest<HTMLElement>('td.ptr-cell');
      const position = host ? { row: host.dataset.row ?? '', column: Number(host.dataset.column) } : selected;
      if (position) openCitation(position.row, position.column, Number(citation.dataset.citation));
      return;
    }
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
    const columnButton = target.closest<HTMLElement>('[data-run-column]');
    if (columnButton && detail) {
      const index = Number(columnButton.dataset.runColumn);
      const review = detail.review;
      const column = review.columns.find((entry) => entry.index === index);
      const sessions = review.rows.filter((row) => emptyColumns(review, row.id, [index]).length).length;
      if (!column) return;
      if (!sessions) {
        toast(app.root, 'Toutes les cellules de cette colonne sont déjà remplies : aucune session à lancer.');
        return;
      }
      void action(async () => {
        const confirmed = await confirmDialog(app.root, 'Lancer la colonne ?', `<p>La question « ${escapeHtml(column.name)} » sera posée pour les <strong>${sessions} ligne${sessions > 1 ? 's' : ''}</strong> dont la cellule est vide, soit ${sessions} session${sessions > 1 ? 's' : ''} IA (${choiceLabel()}). Les cellules déjà remplies ne sont pas reposées.</p>${costlyChoice()}`, 'Lancer');
        if (!confirmed) return;
        const proxyOrigin = await anonymizationProxyOrigin();
        applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/run', { project, file, column: index, proxyOrigin, ...choiceBody() }));
      });
      return;
    }
    if (target.closest('[data-run-cell]') && detail && selected) {
      const { row: rowId, column: index } = selected;
      const filled = isCellFilled(detail.review.cells[rowId]?.[String(index)]);
      void action(async () => {
        if (filled && !await confirmDialog(app.root, 'Relancer cette cellule ?', `<p>La réponse actuelle sera remplacée par celle d’une nouvelle session IA (${choiceLabel()}), qui ne pose que cette question.</p>${costlyChoice()}`, 'Relancer')) return;
        const proxyOrigin = await anonymizationProxyOrigin();
        applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/run', { project, file, rowId, column: index, replace: filled, proxyOrigin, ...choiceBody() }));
      });
      return;
    }
    if (target.closest('[data-update-research]')) {
      app.updateResearch(project, file);
      return;
    }
    if (target.closest('[data-retry]')) {
      void action(async () => {
        const proxyOrigin = await anonymizationProxyOrigin();
        applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/retry', { project, file, proxyOrigin, ...choiceBody() }));
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
