import type { Template } from '../shared.js';
import { OPEN_EVENT, PENDING_TARGET_KEY } from '../shared.js';
import type { App, View } from './app.js';
import { basename } from './dom.js';
import { createHistoryView } from './history.js';
import { createRpc, loadHostProjects } from './host.js';
import type { HostProject, PluginApi } from './host.js';
import { createLaunchView } from './launch.js';
import { createResearchView } from './research.js';
import { createReviewView } from './review.js';
import { PLUGIN_STYLES } from './styles.js';
import { createTemplatesView } from './templates.js';

type TabId = 'launch' | 'research' | 'templates' | 'history';

const TABS: { id: TabId; label: string }[] = [
  { id: 'launch', label: 'Lancer' },
  { id: 'research', label: 'Recherche juridique' },
  { id: 'templates', label: 'Modèles' },
  { id: 'history', label: 'Historique' },
];

const FACTORIES: Record<TabId, (app: App) => View> = {
  launch: createLaunchView,
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

type PendingWindow = Window & { [PENDING_TARGET_KEY]?: unknown };

export function mount(container: HTMLElement, api: PluginApi): void {
  unmount(container);
  const style = document.createElement('style');
  style.textContent = PLUGIN_STYLES;
  const root = document.createElement('div');
  root.className = 'ptr-root';
  root.dataset.theme = api.context.theme;
  root.innerHTML = `
    <header class="ptr-header">
      <div class="ptr-tabs" role="tablist" aria-label="Tabular Review">
        ${TABS.map((tab) => `<button type="button" class="ptr-tab" role="tab" data-tab="${tab.id}" aria-selected="false">${tab.label}</button>`).join('')}
      </div>
      <span class="ptr-spacer"></span>
    </header>
    <div class="ptr-main" data-main></div>`;
  container.append(style, root);
  const main = root.querySelector<HTMLElement>('[data-main]')!;

  let projectsCache: Promise<HostProject[]> | null = null;
  let projectList: HostProject[] = [];
  let templatesCache: Promise<Template[]> | null = null;
  const templateListeners = new Set<(templates: Template[]) => void>();
  const views = new Map<TabId, View>();
  let activeTab: TabId = 'launch';
  let reviewView: View | null = null;

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
      closeReview();
      reviewView = createReviewView(app, project, file, () => {
        closeReview();
        showTab('history');
      });
      for (const view of views.values()) view.element.hidden = true;
      setSelectedTab(null);
      main.appendChild(reviewView.element);
      reviewView.show?.();
    },
    takeTargetProject() {
      const target = (window as PendingWindow)[PENDING_TARGET_KEY];
      delete (window as PendingWindow)[PENDING_TARGET_KEY];
      return typeof target === 'string' && target ? target : null;
    },
  };

  function closeReview() {
    if (!reviewView) return;
    reviewView.destroy();
    reviewView.element.remove();
    reviewView = null;
  }

  function setSelectedTab(tab: TabId | null) {
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected || (!tab && button.dataset.tab === activeTab) ? 0 : -1;
    });
  }

  function showTab(tab: TabId) {
    closeReview();
    activeTab = tab;
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

  root.querySelector('[role=tablist]')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (button) showTab(button.dataset.tab as TabId);
  });

  root.querySelector('[role=tablist]')!.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key !== 'ArrowRight' && keyboard.key !== 'ArrowLeft') return;
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const next = TABS[(index + (keyboard.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    showTab(next.id);
    root.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  });

  const onOpen = () => showTab('launch');
  window.addEventListener(OPEN_EVENT, onOpen);
  const stopContext = api.onContextChange((context) => {
    root.dataset.theme = context.theme;
  });

  showTab('launch');

  mounted.set(container, {
    style,
    root,
    dispose() {
      window.removeEventListener(OPEN_EVENT, onOpen);
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
