import type { Cell, CitationSource, ExportFormat, ExportResult, Provider, Review, ResearchState, ReviewDetail, ReviewRow } from '../shared.js';
import { CATEGORY_LABELS, citationIssue, defaultUpdateSince, emptyColumns, FLAG_LABELS, isCellFilled, MAX_CITATION_CORRECTIONS, RESEARCH_SOURCES, REVIEW_FOLDER, reviewStatusLabel } from '../shared.js';
import type { App, View } from './app.js';
import { confirmDialog, errorMessage, escapeHtml, flagDot, formatDate, downloadBase64, openModal, renderMarkdown, toast } from './dom.js';
import { anonymizationProxyOrigin, caseFiles, loadModels } from './host.js';
import type { ModelOption } from './host.js';
import { openDocumentsDrawer } from './documents-drawer.js';
import { nextSort, sortBy, sortButton } from './ordering.js';
import type { SortState } from './ordering.js';
import { openQuestionsDrawer } from './questions-drawer.js';
import { newPieces, plannedChange, targetPath } from './sorting.js';
import type { PlannedChange } from './sorting.js';
import { selectMenu } from './select-menu.js';

const POLL_INTERVAL = 2500;
const RUNNING_PHASES: ResearchState['phase'][] = ['counting', 'listing', 'downloading'];

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count > 1 ? pluralForm : singular}`;

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

function pieceStatus(row: ReviewRow): string {
  if (!row.piece) return '';
  return `<div class="ptr-row-status" title="${escapeHtml(row.piece)}">${escapeHtml(row.piece)}</div>${row.applied ? `<div class="ptr-row-status" title="Ancien emplacement : ${escapeHtml(row.applied.from)}">✓ Appliqué le ${escapeHtml(formatDate(row.applied.at))}</div>` : ''}`;
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
  // Saisie en cours dans la cellule sélectionnée : survit au rafraîchissement périodique.
  let draft: { key: string; value: string } | null = null;
  let timer = 0;
  let destroyed = false;
  let busy = false;
  let scroll = { top: 0, left: 0 };
  let choice: { provider: Provider; model: string } | null = null;
  let models: { provider: Provider; options: ModelOption[]; cheapest: string } | null = null;
  let barOpen = false;
  let since: string | null = null;
  let researchRun: ResearchState | null = null;
  let researchTimer = 0;
  let questionDrafts: Record<string, string> = {};
  let sort: SortState = null;

  async function loadChoiceModels(provider: Provider) {
    models = { provider, options: [], cheapest: '' };
    render();
    let loaded: { options: ModelOption[]; cheapest: string };
    try {
      loaded = await loadModels(provider);
    } catch {
      loaded = { options: [], cheapest: '' };
    }
    if (destroyed || choice?.provider !== provider) return;
    models = { provider, ...loaded };
    if (choice && !choice.model) choice.model = models.cheapest || models.options[0]?.value || '';
    render();
  }

  function modelSelector(running: boolean): string {
    if (!choice) return '';
    const options = models?.provider === choice.provider ? models.options : [];
    const listed = !choice.model || options.some((option) => option.value === choice!.model) ? options : [{ value: choice.model, label: choice.model }, ...options];
    return `
        <div class="ptr-bar-field" title="IA utilisée pour les relances"><span class="ptr-bar-label">IA</span>${selectMenu('IA', 'provider', choice.provider, PROVIDERS, running)}</div>
        <div class="ptr-bar-field" title="Modèle IA utilisé pour les relances"><span class="ptr-bar-label">Modèle</span>${selectMenu('Modèle', 'model', choice.model, listed.length ? listed : [{ value: '', label: 'Chargement…' }], running || !listed.length)}</div>`;
  }

  function costlyChoice(): string {
    return choice && models?.provider === choice.provider && models.cheapest && choice.model !== models.cheapest
      ? '<span class="ptr-warning">Attention : ce modèle consomme beaucoup de tokens.</span>'
      : '';
  }

  const choiceLabel = () => escapeHtml(choice ? `${choice.provider} — ${choice.model}` : '');
  const choiceBody = () => (choice?.model ? { provider: choice.provider, model: choice.model } : {});

  function researchSummary(review: Review): string {
    const filters = review.research?.filters;
    if (!filters) return '<span class="ptr-small ptr-muted" title="La période et les juridictions de cette recherche ne peuvent pas être modifiées.">Critères non enregistrés</span>';
    const labels = RESEARCH_SOURCES.filter((source) => filters.sources.includes(source.value)).map((source) => source.label);
    return `<button type="button" class="ptr-link-button ptr-ellipsis" data-toggle-bar aria-expanded="${barOpen}" title="${barOpen ? 'Réduire la période et les juridictions' : 'Modifier la période et les juridictions'}">${escapeHtml(filters.dateDebut || '…')} → ${escapeHtml(filters.dateFin || '…')} · ${escapeHtml(labels.join(' · '))} ${barOpen ? '▾' : '▴'}</button>`;
  }

  function researchFields(review: Review, running: boolean): string {
    const filters = review.research?.filters;
    if (!filters || !barOpen) return '';
    const disabled = running ? ' disabled' : '';
    return `<div class="ptr-search-fields">
        <label class="ptr-bar-field"><span class="ptr-bar-label">Du</span><input class="ptr-input" type="date" data-filter-start value="${escapeHtml(filters.dateDebut)}"${disabled}></label>
        <label class="ptr-bar-field"><span class="ptr-bar-label">Au</span><input class="ptr-input" type="date" data-filter-end value="${escapeHtml(filters.dateFin)}"${disabled}></label>
        <div class="ptr-source-chips" role="group" aria-label="Juridictions">${RESEARCH_SOURCES.map((source) => `<label><input type="checkbox" data-filter-source value="${source.value}"${filters.sources.includes(source.value) ? ' checked' : ''}${disabled}> ${escapeHtml(source.label)}</label>`).join('')}</div>
      </div>`;
  }

  function updateControls(review: Review, running: boolean): string {
    if (!review.research?.filters) return '';
    const run = researchRun;
    if (run && RUNNING_PHASES.includes(run.phase)) {
      return `<span class="ptr-small ptr-muted"><span class="ptr-spinner"></span> Recherche en cours : ${plural(run.kept, 'décision retenue', 'décisions retenues')}</span><button type="button" class="ptr-button" data-cancel-update>Arrêter la recherche</button>`;
    }
    if (run) {
      const outcome = run.phase === 'done'
        ? plural(run.kept, 'décision retenue', 'décisions retenues')
        : run.phase === 'cancelled' ? 'Recherche annulée.' : run.error ?? 'Recherche interrompue.';
      return `<span class="ptr-small${run.phase === 'done' ? '' : ' ptr-status-error'}">${escapeHtml(outcome)}</span>${run.phase === 'done' ? `<button type="button" class="ptr-button ptr-button-primary" data-append-update${run.kept ? '' : ' disabled'}>Ajouter et analyser</button>` : ''}<button type="button" class="ptr-button" data-discard-update>${run.phase === 'done' ? 'Abandonner' : 'Fermer'}</button>`;
    }
    return `<label class="ptr-bar-field" title="Décisions rendues depuis le"><span class="ptr-bar-label">Depuis</span><input class="ptr-input" type="date" data-update-since value="${escapeHtml(since ?? defaultUpdateSince(review))}"${running ? ' disabled' : ''}></label><button type="button" class="ptr-button" data-update-research${running ? ' disabled' : ''} title="Cherche les décisions rendues depuis cette date et absentes de la table">Mettre à jour</button>`;
  }

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
        <div><div class="ptr-label">Réponse${cell?.edited ? ' · modifiée à la main' : ''}</div><div style="display:flex;gap:6px">${cell ? flagDot(cell.flag) : ''}<textarea class="ptr-textarea ptr-ghost" data-edit-summary rows="3" aria-label="Réponse de la cellule, modifiable" placeholder="${row.status === 'done' ? 'Aucune réponse' : 'Pas encore de réponse'} — saisissez-la ici"${row.status === 'running' ? ' disabled' : ''}>${escapeHtml(draft?.key === `${row.id}:${column.index}` ? draft.value : isCellFilled(cell) ? cell.summary : '')}</textarea></div>${cell ? `<div class="ptr-small ptr-muted">${escapeHtml(FLAG_LABELS[cell.flag])}</div>` : rowStatus(row)}</div>
        <div><button type="button" class="ptr-button" data-run-cell>${isCellFilled(cell) ? 'Relancer cette cellule' : 'Lancer la session pour cette cellule'}</button></div>
        ${cell ? `
          <div><div class="ptr-label">Justification</div><div class="ptr-md">${cell.reasoning ? renderMarkdown(cell.reasoning) : '<p class="ptr-muted">—</p>'}</div></div>
          <div><div class="ptr-label">Citations</div>${citationList(cell)}${row.corrections ? `<div class="ptr-small ptr-muted">${row.corrections} demande${row.corrections > 1 ? 's' : ''} de correction envoyée${row.corrections > 1 ? 's' : ''} à la session.</div>` : ''}</div>` : ''}
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
    const sorting = review.category === 'tri-pieces';
    const meta = review.research
      ? `Effectuée le ${formatDate(review.createdAt)} · Dossier ${app.projectName(project)} · Recherche : ${review.research.query} · Juridictions : ${review.research.criteria.join(' · ')}`
      : `${review.templateName} · ${app.projectName(project)} · ${formatDate(review.createdAt)}`;
    const research = review.category === 'recherche-juridique';
    element.innerHTML = `
      <div class="ptr-review-top">
        <button type="button" class="ptr-icon-button" data-back aria-label="Retour à l’historique" title="Retour à l’historique">←</button>
        <div class="ptr-review-heading" title="${escapeHtml(meta)}">
          <span class="ptr-review-title">${escapeHtml(review.title)}</span>
          <span class="ptr-small ptr-muted ptr-ellipsis">${escapeHtml(meta)}</span>
        </div>
        ${research || sorting ? `<span class="ptr-chip ptr-chip-category">${escapeHtml(CATEGORY_LABELS[review.category!])}</span>` : ''}
        <span class="ptr-chip ptr-chip-${status}">${running ? '<span class="ptr-spinner"></span>' : ''}${escapeHtml(reviewStatusLabel(status))} · ${done}/${review.rows.length}</span>
        ${running ? `<div class="ptr-progress" aria-hidden="true"><div style="width:${review.rows.length ? Math.round((done / review.rows.length) * 100) : 0}%"></div></div>` : ''}
        ${running ? '<button type="button" class="ptr-button ptr-button-danger" data-cancel>Annuler</button>' : ''}
        <button type="button" class="ptr-button" data-refresh-review aria-label="Actualiser l’analyse" title="Actualiser l’analyse">↻ Actualiser</button>
        ${sorting ? `<button type="button" class="ptr-button" data-add-pieces title="Ajoute une ligne par pièce absente du tri (converties d’abord si besoin) et lance leur analyse">Ajouter les nouvelles pièces</button>
        <button type="button" class="ptr-button ptr-button-primary" data-apply-all title="Renomme et range toutes les pièces selon les colonnes d’action, après confirmation">Appliquer pour tous</button>` : ''}
        <details class="ptr-menu">
          <summary class="ptr-button">Exporter</summary>
          <div class="ptr-menu-list">
            <button type="button" class="ptr-menu-item" data-export="docx">Word (.docx)</button>
            <button type="button" class="ptr-menu-item" data-export="pdf">PDF</button>
          </div>
        </details>
      </div>
      <div class="ptr-review-body">
        <div class="ptr-table-wrap">
          <table class="ptr-table">
            <thead><tr><th scope="col"><div class="ptr-th-sortable"><span>${research ? 'Décision' : 'Document'}</span>${sortButton(sort, 'label', 'document')}</div></th>${review.columns.map((column) => `<th scope="col"><div class="ptr-th-stack"><div class="ptr-th-sortable"><input class="ptr-input ptr-ghost ptr-th-title" data-column-title="${column.index}" value="${escapeHtml(column.name)}" aria-label="Titre de la colonne" placeholder="Titre (facultatif)">${sortButton(sort, `c${column.index}`, column.name)}<button type="button" class="ptr-sort" data-run-column="${column.index}" aria-label="Lancer les cellules vides de cette colonne" title="Lancer les cellules vides de cette colonne">▶</button></div><textarea class="ptr-textarea ptr-ghost ptr-th-input" rows="2" data-column-prompt="${column.index}" aria-label="Question de la colonne" placeholder="Question posée à l’IA">${escapeHtml(questionDrafts[column.index] ?? column.prompt)}</textarea></div></th>`).join('')}<th scope="col" class="ptr-add-col"><button type="button" class="ptr-add" data-add-questions title="Ajouter des questions (colonnes)">+ Question</button></th></tr></thead>
            <tbody>${sortBy(review.rows, sort, (row, key) => key === 'label' ? row.label : review.cells[row.id]?.[key.slice(1)]?.summary ?? '').map((row) => `
              <tr>
                <td><div class="ptr-row-label">${escapeHtml(row.label)}</div>${row.documents.length > 1 ? `<div class="ptr-row-status">${row.documents.length} documents</div>` : ''}${rowStatus(row)}${pieceStatus(row)}${sorting && row.piece ? `<button type="button" class="ptr-button" data-apply-row="${escapeHtml(row.id)}" style="margin-top:4px"${row.status === 'running' ? ' disabled' : ''}>Appliquer</button>` : ''}</td>
                ${review.columns.map((column) => {
                  const cell = review.cells[row.id]?.[String(column.index)];
                  const isSelected = selected?.row === row.id && selected.column === column.index;
                  const content = cell
                    ? `<div class="ptr-cell-content">${flagDot(cell.flag)}<div class="ptr-md">${renderMarkdown(cell.summary)}</div>${cell.edited ? '<span class="ptr-small ptr-muted" title="Réponse modifiée à la main">✎</span>' : ''}</div>${citationLinks(cell)}`
                    : row.status === 'running' ? '<span class="ptr-muted"><span class="ptr-spinner"></span></span>' : '<span class="ptr-muted">—</span>';
                  return `<td class="ptr-cell" tabindex="0" data-row="${escapeHtml(row.id)}" data-column="${column.index}" aria-selected="${isSelected}">${content}</td>`;
                }).join('')}
                <td class="ptr-add-col"></td>
              </tr>`).join('')}
              ${research ? '' : `<tr><td><button type="button" class="ptr-add" data-add-documents title="Ajouter des documents (lignes)">+ Documents</button></td><td colspan="${review.columns.length + 1}"></td></tr>`}
            </tbody>
          </table>
        </div>
        ${renderDetail()}
      </div>
      <div class="ptr-review-bar">
        ${review.research ? researchFields(review, running) : ''}
        <div class="ptr-review-controls">
          ${review.research ? researchSummary(review) : ''}
          ${modelSelector(running)}
          ${costlyChoice()}
          <span class="ptr-spacer"></span>
          ${review.research ? updateControls(review, running) : ''}
          ${running || !failed ? '' : '<button type="button" class="ptr-button" data-retry title="Relance les lignes en échec et complète les cellules vides">Relancer les échecs</button>'}
        </div>
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
        element.innerHTML = `<div class="ptr-review-top"><button type="button" class="ptr-icon-button" data-back aria-label="Retour à l’historique" title="Retour à l’historique">←</button></div><div class="ptr-error-box">${escapeHtml(errorMessage(error))}</div>`;
        return;
      }
      toast(app.root, errorMessage(error), 'error');
    }
    schedule();
  }

  async function action(run: () => Promise<void>) {
    if (busy) return;
    busy = true;
    element.querySelectorAll<HTMLButtonElement>('.ptr-review-top .ptr-button, .ptr-review-bar .ptr-button').forEach((button) => { button.disabled = true; });
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

  function watchResearch() {
    window.clearTimeout(researchTimer);
    if (!destroyed && researchRun && RUNNING_PHASES.includes(researchRun.phase)) researchTimer = window.setTimeout(() => void pollResearch(), POLL_INTERVAL);
  }

  async function pollResearch() {
    const run = researchRun;
    if (!run) return;
    try {
      const next = await app.rpc<ResearchState>('GET', `/research/state?id=${encodeURIComponent(run.id)}`);
      if (destroyed || researchRun?.id !== run.id) return;
      researchRun = next;
    } catch (error) {
      if (destroyed || researchRun?.id !== run.id) return;
      researchRun = { ...run, phase: 'error', error: errorMessage(error) };
    }
    if (!destroyed) render();
    watchResearch();
  }

  async function startResearchUpdate() {
    if (!detail) return;
    researchRun = await app.rpc<ResearchState>('POST', '/research', { update: { project, file, since: since ?? defaultUpdateSince(detail.review) } });
    watchResearch();
  }

  async function cancelResearchUpdate() {
    if (!researchRun) return;
    researchRun = await app.rpc<ResearchState>('POST', '/research/cancel', { id: researchRun.id });
    watchResearch();
  }

  async function discardResearchUpdate() {
    const run = researchRun;
    if (!run) return;
    researchRun = null;
    await app.rpc('POST', '/research/discard', { id: run.id }).catch(() => undefined);
  }

  async function appendResearchUpdate() {
    const run = researchRun;
    if (!run) return;
    const confirmed = await confirmDialog(app.root, 'Ajouter les nouvelles décisions ?', `<p><strong>${plural(run.kept, 'décision retenue', 'décisions retenues')}</strong> seront ajoutées à la revue, puis analysées avec ses questions : <strong>${plural(run.kept, 'session', 'sessions')} IA</strong> (${choiceLabel()}). Les décisions déjà présentes sont ignorées.</p>${costlyChoice()}`, 'Ajouter et analyser');
    if (!confirmed) return;
    const proxyOrigin = await anonymizationProxyOrigin();
    applyDetail(await app.rpc<ReviewDetail>('POST', '/research/append', { id: run.id, project, file, proxyOrigin }));
    researchRun = null;
  }

  async function saveFilters() {
    const start = element.querySelector<HTMLInputElement>('[data-filter-start]')?.value ?? '';
    const end = element.querySelector<HTMLInputElement>('[data-filter-end]')?.value ?? '';
    const sources = [...element.querySelectorAll<HTMLInputElement>('[data-filter-source]:checked')].map((input) => input.value);
    await action(async () => {
      applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/research', { project, file, filters: { dateDebut: start, dateFin: end, sources } }));
    });
  }

  async function projectId(): Promise<string> {
    const id = (await app.projects()).find((entry) => entry.fullPath === project)?.projectId;
    if (!id) throw new Error('Ce dossier est inconnu de PieceMaker.');
    return id;
  }

  /** Renomme et range les pièces des lignes indiquées, après confirmation des noms finaux. */
  async function applyRows(rowIds: string[] | null) {
    if (!detail) return;
    const id = await projectId();
    const pseudonyms = await caseFiles.pseudonyms(id);
    const review = detail.review;
    const changes = review.rows
      .filter((row) => (!rowIds || rowIds.includes(row.id)) && row.status !== 'running')
      .map((row) => plannedChange(review, row, pseudonyms))
      .filter((change): change is PlannedChange => Boolean(change));
    if (!changes.length) {
      toast(app.root, 'Rien à appliquer : les colonnes « Renommer » et « Ranger » sont vides ou la pièce est déjà en place.');
      return;
    }
    const confirmed = await confirmDialog(app.root, `Appliquer ${changes.length} changement${changes.length > 1 ? 's' : ''} ?`, `
      <p>Les pièces originales sont renommées ou rangées sur le disque ; leur Markdown et leur état PieceMaker les suivent. Les codes d’anonymisation sont remplacés par les noms réels.</p>
      <ul class="ptr-summary-list" style="max-height:320px;overflow:auto">${changes.map((change) => `<li><code>${escapeHtml(change.piece)}</code><br>→ <code>${escapeHtml(targetPath(change))}</code></li>`).join('')}</ul>`, 'Appliquer');
    if (!confirmed) return;
    const failures: string[] = [];
    for (const change of changes) {
      try {
        const result = await caseFiles.rename(id, change.piece, change.name, change.directory);
        detail = await app.rpc<ReviewDetail>('POST', '/reviews/applied', { project, file, rowId: change.row.id, current: result.current, markdown: result.markdown });
      } catch (error) {
        failures.push(`${change.piece} : ${errorMessage(error)}`);
      }
    }
    const applied = changes.length - failures.length;
    if (applied) toast(app.root, `${applied} pièce${applied > 1 ? 's' : ''} renommée${applied > 1 ? 's' : ''} ou rangée${applied > 1 ? 's' : ''}.`);
    if (failures.length) {
      await openModal(app.root, {
        title: `${failures.length} changement${failures.length > 1 ? 's' : ''} non appliqué${failures.length > 1 ? 's' : ''}`,
        body: `<ul class="ptr-summary-list">${failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('')}</ul>`,
        actions: [{ label: 'Fermer', value: 'close', kind: 'primary' }],
      });
    }
  }

  /** Ajoute au tri les pièces qui n'y figurent pas, en convertissant d'abord celles qui n'ont pas de Markdown. */
  async function addNewPieces() {
    if (!detail) return;
    const id = await projectId();
    const fresh = newPieces(detail.review, await caseFiles.pieces(id));
    if (!fresh.length) {
      toast(app.root, 'Aucune nouvelle pièce dans le dossier.');
      return;
    }
    const toConvert = fresh.filter((piece) => !piece.markdown).map((piece) => piece.path);
    const confirmed = await confirmDialog(app.root, 'Ajouter les nouvelles pièces ?', `
      <p><strong>${fresh.length} pièce${fresh.length > 1 ? 's' : ''}</strong> ne figure${fresh.length > 1 ? 'nt' : ''} pas encore dans ce tri${toConvert.length ? `, dont ${toConvert.length} à convertir d’abord en Markdown` : ''}. Chacune devient une ligne analysée par une session IA (${choiceLabel()}).</p>
      <ul class="ptr-summary-list" style="max-height:240px;overflow:auto">${fresh.map((piece) => `<li>${escapeHtml(piece.path)}</li>`).join('')}</ul>${costlyChoice()}`, 'Ajouter');
    if (!confirmed) return;
    if (toConvert.length) {
      toast(app.root, `Conversion de ${toConvert.length} pièce${toConvert.length > 1 ? 's' : ''}…`);
      await caseFiles.convert(id, toConvert);
    }
    const ready = newPieces(detail.review, await caseFiles.pieces(id)).filter((piece) => piece.markdown);
    if (ready.length < fresh.length) toast(app.root, `${fresh.length - ready.length} pièce${fresh.length - ready.length > 1 ? 's n’ont' : ' n’a'} pas pu être convertie${fresh.length - ready.length > 1 ? 's' : ''}.`, 'error');
    if (!ready.length) return;
    const proxyOrigin = await anonymizationProxyOrigin();
    const rows = ready.map((piece) => ({ label: piece.path.split('/').pop()!.replace(/\.[^.]+$/, ''), documents: [piece.markdown], piece: piece.path }));
    applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/append', { project, file, rows, proxyOrigin }));
  }

  function addQuestions() {
    openQuestionsDrawer(app, async ({ columns }) => {
      let latest: ReviewDetail | null = null;
      for (const column of columns) latest = await app.rpc<ReviewDetail>('POST', '/reviews/column', { project, file, prompt: column.prompt, title: column.name, format: column.format, tags: column.tags });
      if (latest) applyDetail(latest);
      toast(app.root, `${plural(columns.length, 'question ajoutée', 'questions ajoutées')} : lancez ${columns.length > 1 ? 'chaque colonne' : 'la colonne'} avec ▶.`);
    });
  }

  function addDocuments() {
    if (!detail) return;
    const review = detail.review;
    openDocumentsDrawer(app, {
      project,
      sorting: review.category === 'tri-pieces',
      existing: new Set(review.rows.flatMap((row) => row.documents.map((document) => document.source))),
      async onSubmit(rows) {
        const confirmed = await confirmDialog(app.root, 'Ajouter des documents ?', `<p>${plural(rows.length, 'nouvelle ligne sera analysée', 'nouvelles lignes seront analysées')} par une session IA chacune (${choiceLabel()}).</p>${costlyChoice()}`, 'Ajouter et analyser');
        if (!confirmed) return false;
        const proxyOrigin = await anonymizationProxyOrigin();
        applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/append', { project, file, rows, proxyOrigin }));
      },
    });
  }

  element.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-column-prompt], [data-column-title]')) {
      const index = target.dataset.columnPrompt ?? target.dataset.columnTitle ?? '';
      const prompt = element.querySelector<HTMLTextAreaElement>(`[data-column-prompt="${index}"]`)?.value ?? '';
      const title = element.querySelector<HTMLInputElement>(`[data-column-title="${index}"]`)?.value ?? '';
      void action(async () => {
        applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/column', { project, file, column: Number(index), prompt, title }));
        delete questionDrafts[index];
      });
      return;
    }
    if (target.matches('[data-filter-start],[data-filter-end],[data-filter-source]')) {
      void saveFilters();
      return;
    }
    if (target.matches('[data-edit-summary]') && selected) {
      const summary = (target as HTMLTextAreaElement).value;
      const { row: rowId, column } = selected;
      void action(async () => {
        applyDetail(await app.rpc<ReviewDetail>('POST', '/reviews/cell', { project, file, rowId, column, summary }));
        draft = null;
        toast(app.root, summary.trim() ? 'Réponse modifiée.' : 'Réponse effacée.');
      });
      return;
    }
    if (target.matches('[data-update-since]')) {
      since = (target as HTMLInputElement).value;
      return;
    }
  });

  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const option = target.closest<HTMLButtonElement>('[data-choice-option]');
    if (option && !option.disabled && choice) {
      if (option.dataset.choiceOption === 'provider') {
        const provider = option.dataset.value as Provider;
        choice = { provider, model: '' };
        void loadChoiceModels(provider);
      } else {
        choice.model = option.dataset.value ?? '';
        render();
      }
      return;
    }
    if (target.closest('[data-refresh-review]')) {
      void load();
      return;
    }
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
    if (target.closest('[data-toggle-bar]')) {
      barOpen = !barOpen;
      render();
      return;
    }
    const sortKey = target.closest<HTMLElement>('[data-sort]')?.dataset.sort;
    if (sortKey) {
      sort = nextSort(sort, sortKey);
      render();
      return;
    }
    if (target.closest('[data-add-questions]')) {
      addQuestions();
      return;
    }
    if (target.closest('[data-add-documents]')) {
      addDocuments();
      return;
    }
    if (target.closest('[data-update-research]')) {
      void action(startResearchUpdate);
      return;
    }
    if (target.closest('[data-cancel-update]')) {
      void action(cancelResearchUpdate);
      return;
    }
    if (target.closest('[data-append-update]')) {
      void action(appendResearchUpdate);
      return;
    }
    if (target.closest('[data-discard-update]')) {
      void action(discardResearchUpdate);
      return;
    }
    if (target.closest('[data-cancel]')) {
      void action(async () => {
        if (!await confirmDialog(app.root, 'Annuler l’analyse tabulaire ?', '<p>Les sessions IA en cours sont arrêtées ; les lignes déjà analysées sont conservées.</p>', 'Arrêter', true)) return;
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
    const applyRow = target.closest<HTMLElement>('[data-apply-row]');
    if (applyRow) {
      void action(() => applyRows([applyRow.dataset.applyRow ?? '']));
      return;
    }
    if (target.closest('[data-apply-all]')) {
      void action(() => applyRows(null));
      return;
    }
    if (target.closest('[data-add-pieces]')) {
      void action(addNewPieces);
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
      exportButton.closest('details')?.removeAttribute('open');
      void action(async () => {
        const result = await app.rpc<ExportResult>('POST', '/reviews/export', { project, file, format });
        downloadBase64(result.filename, result.base64, MIME_TYPES[format]);
        toast(app.root, `Export enregistré dans « ${REVIEW_FOLDER}/${result.filename} ».`);
      });
      return;
    }
    const cell = target.closest<HTMLElement>('td.ptr-cell');
    if (cell) {
      selected = { row: cell.dataset.row ?? '', column: Number(cell.dataset.column) };
      render();
    }
  });

  element.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-column-prompt]')) questionDrafts[target.dataset.columnPrompt ?? ''] = (target as HTMLTextAreaElement).value;
    if (target.matches('[data-edit-summary]') && selected) draft = { key: `${selected.row}:${selected.column}`, value: (target as HTMLTextAreaElement).value };
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
      window.clearTimeout(researchTimer);
    },
  };
}
