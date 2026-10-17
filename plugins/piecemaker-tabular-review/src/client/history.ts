import type { Draft, ReviewCategory, ReviewSummary } from '../shared.js';
import { CATEGORY_LABELS, DEFAULT_MODEL, DEFAULT_PROVIDER, reviewStatusLabel } from '../shared.js';
import type { App, View } from './app.js';
import { confirmDialog, errorMessage, escapeHtml, formatDate, toast } from './dom.js';
import type { HostProject } from './host.js';
import { nextSort, sortBy, sortButton } from './ordering.js';
import type { SortState } from './ordering.js';

const ALL = '';
const REFRESH_INTERVAL = 5000;

type Entry = ReviewSummary & { draft?: Draft };

const statusLabel = (entry: Entry) => entry.draft ? 'Projet' : reviewStatusLabel(entry.status);

function draftEntry(draft: Draft): Entry {
  const provider = draft.provider ?? DEFAULT_PROVIDER;
  return { project: draft.project, file: '', title: draft.title, templateName: draft.templateName || `${draft.columns.length} question${draft.columns.length > 1 ? 's' : ''}`, category: draft.mode === 'recherche' ? 'recherche-juridique' : 'documents', createdAt: draft.updatedAt, status: 'done', rowCount: draft.rows.length, doneCount: 0, columnCount: draft.columns.length, provider, model: draft.model ?? DEFAULT_MODEL[provider], draft } as Entry;
}

export function createHistoryView(app: App): View {
  const element = document.createElement('div');
  element.className = 'ptr-page';
  element.innerHTML = `
    <div class="ptr-toolbar">
      <input class="ptr-input ptr-toolbar-search" data-search placeholder="Rechercher une analyse…" aria-label="Rechercher">
      <select class="ptr-select ptr-toolbar-select" data-filter aria-label="Dossier"><option value="">Tous les dossiers</option></select>
      <select class="ptr-select ptr-toolbar-select" data-category aria-label="Catégorie"><option value="">Toutes les catégories</option></select>
      <button type="button" class="ptr-icon-button" data-refresh aria-label="Actualiser" title="Actualiser">↻</button>
    </div>
    <div data-list><div class="ptr-empty"><span class="ptr-spinner"></span> Chargement…</div></div>
    <div class="ptr-home-bar">
      <button type="button" class="ptr-button" data-templates>Modèles</button>
      <span class="ptr-spacer"></span>
      <button type="button" class="ptr-button ptr-button-primary" data-new-research>+ Nouvelle recherche</button>
      <button type="button" class="ptr-button ptr-button-primary" data-new-table>+ Nouvelle analyse</button>
    </div>`;
  const filter = element.querySelector<HTMLSelectElement>('[data-filter]')!;
  const categoryFilter = element.querySelector<HTMLSelectElement>('[data-category]')!;
  const list = element.querySelector<HTMLElement>('[data-list]')!;
  let projects: HostProject[] = [];
  let reviews: Entry[] = [];
  let visible: Entry[] = [];
  let sort: SortState = { key: 'date', direction: -1 };
  const search = element.querySelector<HTMLInputElement>('[data-search]')!;
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
    const query = search.value.trim().toLowerCase();
    const filtered = reviews.filter((review) => (!categoryFilter.value || review.category === categoryFilter.value) && (!query || review.title.toLowerCase().includes(query)));
    visible = sortBy(filtered, sort, (review, key) => key === 'title' ? review.title : key === 'status' ? statusLabel(review) : key === 'project' ? app.projectName(review.project) : key === 'rows' ? String(review.rowCount) : review.createdAt);
    if (!visible.length) {
      list.innerHTML = '<div class="ptr-empty">Aucune analyse tabulaire pour ce filtre.</div>';
      return;
    }
    const header = (key: string, label: string) => `<th scope="col"><div class="ptr-th-sortable"><span>${label}</span>${sortButton(sort, key, label.toLowerCase())}</div></th>`;
    list.innerHTML = `<div class="ptr-table-wrap ptr-history-wrap"><table class="ptr-table ptr-history-table">
      <thead><tr>${header('title', 'Nom')}${header('status', 'Statut')}${header('project', 'Dossier')}${header('rows', 'Lignes')}${header('date', 'Date')}<th scope="col">Action</th></tr></thead>
      <tbody>${visible.map((review, index) => `
        <tr class="ptr-history-row" data-index="${index}" role="button" tabindex="0" title="${escapeHtml(review.draft ? 'Projet non lancé' : review.file)}">
          <td><strong class="ptr-link">${escapeHtml(review.title)}</strong>${review.category === 'documents' ? '' : ` <span class="ptr-chip ptr-chip-category">${escapeHtml(CATEGORY_LABELS[review.category])}</span>`}<div class="ptr-small ptr-muted ptr-ellipsis">${escapeHtml(review.query ? `Requête : ${review.query}` : review.templateName)}</div></td>
          <td><span class="ptr-chip ptr-chip-${review.draft ? 'draft' : review.status}">${!review.draft && review.status === 'running' ? '<span class="ptr-spinner"></span>' : ''}${escapeHtml(statusLabel(review))}</span></td>
          <td title="${escapeHtml(review.project)}">${escapeHtml(app.projectName(review.project))}</td>
          <td>${review.draft ? review.rowCount : `${review.doneCount}/${review.rowCount}`}</td>
          <td>${escapeHtml(formatDate(review.createdAt))}</td>
          <td>${!review.draft && review.status === 'running' ? '' : '<button type="button" class="ptr-icon-button" data-delete aria-label="Supprimer l’analyse tabulaire" title="Supprimer l’analyse tabulaire">🗑</button>'}</td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  function schedule() {
    window.clearTimeout(timer);
    if (!destroyed && !element.hidden && reviews.some((review) => !review.draft && review.status === 'running')) {
      timer = window.setTimeout(() => void load(), REFRESH_INTERVAL);
    }
  }

  async function load() {
    const current = ++request;
    try {
      const selected = filter.value ? [filter.value] : projects.map((project) => project.fullPath);
      const [result, drafts] = await Promise.all([
        app.rpc<{ reviews: ReviewSummary[] }>('POST', '/reviews/list', { projects: selected }),
        app.rpc<{ drafts: Draft[] }>('POST', '/drafts/list', { projects: selected }).catch(() => ({ drafts: [] })),
      ]);
      if (current !== request || destroyed) return;
      reviews = [...drafts.drafts.map(draftEntry), ...result.reviews];
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
    if (review?.draft) app.openDraft(review.draft);
    else if (review) app.openReview(review.project, review.file);
  };

  const remove = async (target: HTMLElement) => {
    const review = visible[Number(target.closest<HTMLElement>('[data-index]')?.dataset.index)];
    if (!review) return;
    if (review.draft) {
      if (!await confirmDialog(app.root, 'Supprimer le projet', `<p>Le projet « ${escapeHtml(review.title)} », jamais lancé, sera supprimé.</p>`, 'Supprimer', true)) return;
      await app.rpc('POST', '/drafts/delete', { id: review.draft.id }).catch((error) => toast(app.root, errorMessage(error), 'error'));
      await load();
      return;
    }
    const confirmed = await confirmDialog(app.root, 'Supprimer l’analyse tabulaire', `<p>« ${escapeHtml(review.title)} » sera supprimée définitivement : son fichier JSON, ses exports Word/PDF et les copies de documents qu’elle est seule à utiliser.</p>`, 'Supprimer', true);
    if (!confirmed) return;
    try {
      await app.rpc('POST', '/reviews/delete', { project: review.project, file: review.file });
      toast(app.root, 'Analyse tabulaire supprimée.');
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
    const sortKey = target.closest<HTMLElement>('[data-sort]')?.dataset.sort;
    if (sortKey) {
      sort = nextSort(sort, sortKey);
      render();
    } else if (target.closest('[data-new-table]')) app.newTable(filter.value || null);
    else if (target.closest('[data-templates]')) app.showTemplates();
    else if (target.closest('[data-new-research]')) app.newResearch(filter.value || null);
    else if (target.closest('[data-refresh]')) void load();
    else if (target.closest('[data-delete]')) void remove(target);
    else if (target.closest('[data-index]')) open(target);
  });
  search.addEventListener('input', render);
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
