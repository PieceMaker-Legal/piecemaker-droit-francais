import type { ReviewCategory, ReviewSummary } from '../shared.js';
import { CATEGORY_LABELS, reviewStatusLabel } from '../shared.js';
import type { App, View } from './app.js';
import { confirmDialog, errorMessage, escapeHtml, formatDate, toast } from './dom.js';
import type { HostProject } from './host.js';

const ALL = '';
const REFRESH_INTERVAL = 5000;

export function createHistoryView(app: App): View {
  const element = document.createElement('div');
  element.className = 'ptr-page';
  element.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:8px">
      <label class="ptr-field" style="width:280px"><span class="ptr-label">Dossier</span><select class="ptr-select" data-filter><option value="">Tous les dossiers</option></select></label>
      <label class="ptr-field" style="width:220px"><span class="ptr-label">Catégorie</span><select class="ptr-select" data-category><option value="">Toutes les catégories</option></select></label>
      <span class="ptr-spacer"></span>
      <button type="button" class="ptr-button" data-refresh>Actualiser</button>
    </div>
    <div data-list><div class="ptr-empty"><span class="ptr-spinner"></span> Chargement…</div></div>`;
  const filter = element.querySelector<HTMLSelectElement>('[data-filter]')!;
  const categoryFilter = element.querySelector<HTMLSelectElement>('[data-category]')!;
  const list = element.querySelector<HTMLElement>('[data-list]')!;
  let projects: HostProject[] = [];
  let reviews: ReviewSummary[] = [];
  let visible: ReviewSummary[] = [];
  let timer = 0;
  let request = 0;
  let destroyed = false;

  function renderFilter() {
    const current = filter.value;
    filter.innerHTML = `<option value="${ALL}">Tous les dossiers</option>${projects.map((project) => `<option value="${escapeHtml(project.fullPath)}">${escapeHtml(project.displayName)}</option>`).join('')}`;
    filter.value = projects.some((project) => project.fullPath === current) ? current : ALL;
  }

  function renderCategories() {
    const current = categoryFilter.value;
    const present = (Object.keys(CATEGORY_LABELS) as ReviewCategory[]).filter((category) => category === current || reviews.some((review) => review.category === category));
    categoryFilter.innerHTML = `<option value="${ALL}">Toutes les catégories</option>${present.map((category) => `<option value="${category}">${escapeHtml(CATEGORY_LABELS[category])}</option>`).join('')}`;
    categoryFilter.value = present.includes(current as ReviewCategory) ? current : ALL;
  }

  function render() {
    renderCategories();
    visible = categoryFilter.value ? reviews.filter((review) => review.category === categoryFilter.value) : reviews;
    if (!visible.length) {
      list.innerHTML = '<div class="ptr-empty">Aucune tabular review pour ce filtre.</div>';
      return;
    }
    list.innerHTML = `<div class="ptr-list">${visible.map((review, index) => `
      <div class="ptr-list-row" data-index="${index}" role="button" tabindex="0" title="${escapeHtml(review.file)}">
        <span class="ptr-small ptr-muted" style="flex-shrink:0;width:92px;padding-left:6px">${escapeHtml(formatDate(review.createdAt))}</span>
        <strong>${escapeHtml(review.title)}</strong>
        ${review.category === 'documents' ? '' : `<span class="ptr-chip ptr-chip-category">${escapeHtml(CATEGORY_LABELS[review.category])}</span>`}
        <span class="ptr-ellipsis ptr-muted">${escapeHtml(review.query ? `Requête : ${review.query}` : review.templateName)}</span>
        <span class="ptr-chip" title="${escapeHtml(review.project)}">${escapeHtml(app.projectName(review.project))}</span>
        <span class="ptr-small ptr-muted" style="flex-shrink:0">${review.doneCount}/${review.rowCount} ligne${review.rowCount > 1 ? 's' : ''}</span>
        <span class="ptr-chip ptr-chip-${review.status}">${review.status === 'running' ? '<span class="ptr-spinner"></span>' : ''}${escapeHtml(reviewStatusLabel(review.status))}</span>
        ${review.status === 'running' ? '' : '<button type="button" class="ptr-icon-button" data-delete aria-label="Supprimer la tabular review" title="Supprimer la tabular review">🗑</button>'}
      </div>`).join('')}</div>`;
  }

  function schedule() {
    window.clearTimeout(timer);
    if (!destroyed && !element.hidden && reviews.some((review) => review.status === 'running')) {
      timer = window.setTimeout(() => void load(), REFRESH_INTERVAL);
    }
  }

  async function load() {
    const current = ++request;
    try {
      const selected = filter.value ? [filter.value] : projects.map((project) => project.fullPath);
      const result = await app.rpc<{ reviews: ReviewSummary[] }>('POST', '/reviews/list', { projects: selected });
      if (current !== request || destroyed) return;
      reviews = result.reviews;
      render();
    } catch (error) {
      if (current !== request || destroyed) return;
      list.innerHTML = `<div class="ptr-error-box">${escapeHtml(errorMessage(error))}</div>`;
    }
    schedule();
  }

  async function initialize() {
    try {
      projects = await app.projects(true);
    } catch (error) {
      list.innerHTML = `<div class="ptr-error-box">${escapeHtml(errorMessage(error))}</div>`;
      return;
    }
    renderFilter();
    await load();
  }

  const open = (target: HTMLElement) => {
    const review = visible[Number(target.closest<HTMLElement>('[data-index]')?.dataset.index)];
    if (review) app.openReview(review.project, review.file);
  };

  const remove = async (target: HTMLElement) => {
    const review = visible[Number(target.closest<HTMLElement>('[data-index]')?.dataset.index)];
    if (!review) return;
    const confirmed = await confirmDialog(app.root, 'Supprimer la tabular review', `<p>« ${escapeHtml(review.title)} » sera supprimée définitivement : son fichier JSON, ses exports Word/PDF et les copies de documents qu’elle est seule à utiliser.</p>`, 'Supprimer', true);
    if (!confirmed) return;
    try {
      await app.rpc('POST', '/reviews/delete', { project: review.project, file: review.file });
      toast(app.root, 'Tabular review supprimée.');
      await load();
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    }
  };

  element.addEventListener('change', (event) => {
    if (event.target === filter) void load();
    else if (event.target === categoryFilter) render();
  });
  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-refresh]')) void load();
    else if (target.closest('[data-delete]')) void remove(target);
    else open(target);
  });
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.target as HTMLElement).matches('[data-index]')) open(event.target as HTMLElement);
  });

  void initialize();

  return {
    element,
    show() {
      void app.projects().then((loaded) => {
        projects = loaded;
        renderFilter();
        return load();
      });
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
    },
  };
}
