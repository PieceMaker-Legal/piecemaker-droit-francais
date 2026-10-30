import type { Draft, Template } from '../shared.js';
import { OPEN_EVENT, PANEL_FOCUS_EVENT, PENDING_SHOW_KEY, PENDING_TARGET_KEY, REVIEW_FOLDER, SHOW_EVENT } from '../shared.js';
import type { App, View } from './app.js';
import { basename, errorMessage, escapeHtml, openModal, toast } from './dom.js';
import { createHistoryView } from './history.js';
import { createRpc, loadHostProjects } from './host.js';
import type { HostProject, PluginApi } from './host.js';
import { createLaunchView } from './launch.js';
import { createResearchView } from './research.js';
import { createReviewView } from './review.js';
import { PLUGIN_STYLES } from './styles.js';
import { createTemplatesView } from './templates.js';

type TabId = 'history' | 'templates' | 'research';

const TITLES: Record<TabId, string> = {
  history: 'Analyses tabulaires',
  templates: 'Modèles',
  research: 'Nouvelle recherche juridique',
};

const FACTORIES: Record<TabId, (app: App) => View> = {
  research: createResearchView,
  templates: createTemplatesView,
  history: createHistoryView,
};

type Mounted = {
  style: HTMLStyleElement;
  root: HTMLElement;
  dispose(): void;
};

const mounted = new WeakMap<HTMLElement, Mounted>();

type PendingWindow = Window & { [PENDING_TARGET_KEY]?: unknown; [PENDING_SHOW_KEY]?: unknown };

type ShowRequest = { project: string | null; review: string | null; draft: string | null; chronology: boolean };

function takeShowRequest(): ShowRequest | null {
  const pending = window as PendingWindow;
  const request = pending[PENDING_SHOW_KEY] as { project?: unknown; review?: unknown; draft?: unknown; chronology?: unknown } | undefined;
  delete pending[PENDING_SHOW_KEY];
  if (!request || typeof request !== 'object') return null;
  const text = (value: unknown) => typeof value === 'string' && value ? value : null;
  return { project: text(request.project), review: text(request.review), draft: text(request.draft), chronology: request.chronology === true };
}

export function mount(container: HTMLElement, api: PluginApi): void {
  unmount(container);
  const style = document.createElement('style');
  style.textContent = PLUGIN_STYLES;
  const root = document.createElement('div');
  root.className = 'ptr-root';
  root.dataset.theme = api.context.theme;
  root.innerHTML = `
    <header class="ptr-header" data-subbar hidden>
      <button type="button" class="ptr-icon-button" data-home aria-label="Retour à l’historique" title="Retour à l’historique">←</button>
      <span class="ptr-review-title" data-subbar-title></span>
    </header>
    <div class="ptr-main" data-main></div>`;
  container.append(style, root);
  const main = root.querySelector<HTMLElement>('[data-main]')!;

  let projectsCache: Promise<HostProject[]> | null = null;
  let projectList: HostProject[] = [];
  let templatesCache: Promise<Template[]> | null = null;
  const templateListeners = new Set<(templates: Template[]) => void>();
  const views = new Map<TabId, View>();
  let reviewView: View | null = null;
  let pendingUpdate: { project: string; file: string } | null = null;
  let pendingStart: { project: string; title: string; draft?: Draft } | null = null;

  const app: App = {
    root,
    api,
    rpc: createRpc(api),
    context: () => api.context,
    projects(refresh = false) {
      if (!projectsCache || refresh) {
        const pending = loadHostProjects().then((projects) => {
          projectList = projects;
          return projects;
        });
        pending.catch(() => {
          if (projectsCache === pending) projectsCache = null;
        });
        projectsCache = pending;
      }
      return projectsCache;
    },
    projectName(path) {
      return projectList.find((project) => project.fullPath === path)?.displayName ?? basename(path);
    },
    templates(refresh = false) {
      if (!templatesCache || refresh) {
        const pending = app.rpc<{ templates: Template[] }>('GET', '/templates').then((result) => {
          for (const listener of templateListeners) listener(result.templates);
          return result.templates;
        });
        pending.catch(() => {
          if (templatesCache === pending) templatesCache = null;
        });
        templatesCache = pending;
      }
      return templatesCache;
    },
    setTemplates(templates) {
      templatesCache = Promise.resolve(templates);
      for (const listener of templateListeners) listener(templates);
    },
    onTemplatesChange(callback) {
      templateListeners.add(callback);
      return () => templateListeners.delete(callback);
    },
    openReview(project, file) {
      showPage(createReviewView(app, project, file, backToHistory));
      focusTable(`${project}/${REVIEW_FOLDER}/${file}`);
    },
    openDraft(draft) {
      if (draft.mode === 'recherche') {
        pendingStart = { project: draft.project, title: draft.title, draft };
        showTab('research');
        return;
      }
      showPage(createLaunchView(app, draft, backToHistory));
      focusTable(null);
    },
    newTable(preferred = null) {
      void askNewTable(preferred);
    },
    showTemplates() {
      showTab('templates');
    },
    newResearch(preferred = null) {
      void askNewResearch(preferred);
    },
    takeResearchStart() {
      const start = pendingStart;
      pendingStart = null;
      return start;
    },
    updateResearch(project, file) {
      pendingUpdate = { project, file };
      showTab('research');
    },
    takeResearchUpdate() {
      const update = pendingUpdate;
      pendingUpdate = null;
      return update;
    },
    takeTargetProject() {
      const target = (window as PendingWindow)[PENDING_TARGET_KEY];
      delete (window as PendingWindow)[PENDING_TARGET_KEY];
      return typeof target === 'string' && target ? target : null;
    },
  };

  function backToHistory() {
    closeReview();
    showTab('history');
    focusTable(null);
  }

  function focusTable(file: string | null) {
    window.dispatchEvent(new CustomEvent(PANEL_FOCUS_EVENT, { detail: { tab: 'plugin:piecemaker-tabular-review', file } }));
  }

  function showPage(view: View) {
    closeReview();
    reviewView = view;
    for (const entry of views.values()) entry.element.hidden = true;
    setSelectedTab(null);
    main.appendChild(view.element);
    view.show?.();
  }

  async function askName(heading: string, preferred: string | null): Promise<{ project: string; name: string } | null> {
    const projects = await app.projects().catch(() => [] as HostProject[]);
    const initial = projects.find((entry) => entry.fullPath === preferred)?.fullPath ?? api.context.project?.path ?? projects[0]?.fullPath ?? '';
    let name = '';
    let project = initial;
    const answer = await openModal(root, {
      title: heading,
      body: `
        <label class="ptr-field"><span class="ptr-label-row"><span class="ptr-label">Nom du tableau</span><span class="ptr-small ptr-muted" data-remaining>120 caractères restants</span></span><input class="ptr-input" data-table-name maxlength="120" placeholder="ex. Notion de faute lourde"></label>
        <label class="ptr-field"><span class="ptr-label">Dossier</span><select class="ptr-select" data-table-project>${projects.map((entry) => `<option value="${escapeHtml(entry.fullPath)}"${entry.fullPath === initial ? ' selected' : ''}>${escapeHtml(entry.displayName)}</option>`).join('') || '<option value="">Aucun dossier</option>'}</select></label>`,
      actions: [{ label: 'Annuler', value: 'cancel' }, { label: 'Créer', value: 'create', kind: 'primary' }],
      onMount(dialog, close) {
        const create = dialog.querySelector<HTMLButtonElement>('[data-modal-action="create"]')!;
        create.disabled = true;
        dialog.addEventListener('input', (event) => {
          const field = event.target as HTMLInputElement;
          if (field.hasAttribute('data-table-name')) {
            name = field.value;
            dialog.querySelector('[data-remaining]')!.textContent = `${120 - name.length} caractères restants`;
          }
          create.disabled = !name.trim() || !project;
        });
        dialog.addEventListener('change', (event) => {
          const field = event.target as HTMLSelectElement;
          if (field.hasAttribute('data-table-project')) project = field.value;
          create.disabled = !name.trim() || !project;
        });
        dialog.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (event.target as HTMLElement).hasAttribute('data-table-name') && name.trim() && project) close('create');
        });
      },
    });
    if (answer !== 'create' || !name.trim() || !project) return null;
    return { project, name: name.trim() };
  }

  async function askNewTable(preferred: string | null) {
    const answer = await askName('Nouveau tableau', preferred);
    if (!answer) return;
    try {
      const { draft } = await app.rpc<{ draft: Draft }>('PUT', '/drafts', { draft: { project: answer.project, title: answer.name, columns: [], rows: [] } });
      app.openDraft(draft);
    } catch (error) {
      toast(root, errorMessage(error), 'error');
    }
  }

  async function askNewResearch(preferred: string | null) {
    const answer = await askName('Nouvelle recherche', preferred);
    if (!answer) return;
    pendingStart = { project: answer.project, title: answer.name };
    showTab('research');
  }

  function closeReview() {
    if (!reviewView) return;
    reviewView.destroy();
    reviewView.element.remove();
    reviewView = null;
  }

  let selectedTab: TabId | null = 'history';

  function setSelectedTab(tab: TabId | null) {
    selectedTab = tab;
    root.querySelector<HTMLElement>('[data-subbar]')!.hidden = !tab || tab === 'history';
    if (tab) root.querySelector<HTMLElement>('[data-subbar-title]')!.textContent = TITLES[tab];
  }

  function showTab(tab: TabId) {
    closeReview();
    let view = views.get(tab);
    if (!view) {
      view = FACTORIES[tab](app);
      views.set(tab, view);
      main.appendChild(view.element);
    } else {
      view.show?.();
    }
    for (const [id, entry] of views) entry.element.hidden = id !== tab;
    setSelectedTab(tab);
    main.scrollTop = 0;
  }

  root.querySelector('[data-home]')!.addEventListener('click', () => showTab('history'));

  const onOpen = () => {
    showTab('history');
    app.newTable(app.takeTargetProject());
  };
  window.addEventListener(OPEN_EVENT, onOpen);
  async function openDraftById(project: string, id: string) {
    try {
      const { drafts } = await app.rpc<{ drafts: Draft[] }>('POST', '/drafts/list', { projects: [project] });
      const draft = drafts.find((entry) => entry.id === id);
      if (draft) app.openDraft(draft);
      else showTab('history');
    } catch (error) {
      toast(root, errorMessage(error), 'error');
    }
  }

  async function openChronology(project: string) {
    try {
      const { fichier, projet } = await app.rpc<{ fichier?: string; projet?: string }>('POST', '/assistant', { action: 'chronologie', project });
      if (fichier) app.openReview(project, fichier);
      else if (projet) await openDraftById(project, projet);
    } catch (error) {
      toast(root, errorMessage(error), 'error');
    }
  }

  const onShow = () => {
    const request = takeShowRequest();
    if (!request) return;
    if (request.project && request.chronology) {
      void openChronology(request.project);
      return;
    }
    if (request.project && request.draft) {
      void openDraftById(request.project, request.draft);
      return;
    }
    if (request.project && request.review) {
      app.openReview(request.project, request.review);
      return;
    }
    if (reviewView || selectedTab === 'research') return;
    showTab('history');
  };
  window.addEventListener(SHOW_EVENT, onShow);
  const initialRequest = takeShowRequest();
  const stopContext = api.onContextChange((context) => {
    root.dataset.theme = context.theme;
  });

  showTab('history');
  if (initialRequest?.project && initialRequest.chronology) void openChronology(initialRequest.project);
  else if (initialRequest?.project && initialRequest.draft) void openDraftById(initialRequest.project, initialRequest.draft);
  else if (initialRequest?.project && initialRequest.review) app.openReview(initialRequest.project, initialRequest.review);
  else if (!initialRequest?.project) {
    const target = app.takeTargetProject();
    if (target) app.newTable(target);
  }

  mounted.set(container, {
    style,
    root,
    dispose() {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener(SHOW_EVENT, onShow);
      stopContext();
      closeReview();
      for (const view of views.values()) view.destroy();
      views.clear();
      templateListeners.clear();
    },
  });
}

export function unmount(container: HTMLElement): void {
  const state = mounted.get(container);
  if (!state) return;
  state.dispose();
  state.style.remove();
  state.root.remove();
  mounted.delete(container);
}
