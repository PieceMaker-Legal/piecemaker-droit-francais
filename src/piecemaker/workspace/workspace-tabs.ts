const tabIconSelectors = {
  chat: 'svg.lucide-message-square',
  dossier: 'svg.lucide-scale',
  files: 'svg.lucide-folder',
  library: 'svg.lucide-clipboard-check',
  browser: 'svg.lucide-monitor-play',
  shell: 'svg.lucide-terminal',
  git: 'svg.lucide-git-branch',
} as const;

const orderedTabNames = ['chat', 'dossier', 'files', 'library', 'browser', 'shell'] as const;

type WorkspaceTabName = (typeof orderedTabNames)[number];

const getTabWrapper = (tablist: HTMLElement, selector: string): HTMLElement | null => {
  for (const child of Array.from(tablist.children)) {
    if (child instanceof HTMLElement && child.querySelector(`button[role="tab"] ${selector}`)) return child;
  }
  return null;
};

const applyWorkspaceTabLayout = (): void => {
  const tablists = Array.from(document.querySelectorAll<HTMLElement>('[role="tablist"]')).filter(
    (tablist) => tablist.querySelector(tabIconSelectors.chat)
      && tablist.querySelector(tabIconSelectors.files)
      && tablist.querySelector(tabIconSelectors.shell),
  );

  for (const tablist of tablists) {
    const wrappers = Array.from(tablist.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && Boolean(child.querySelector('button[role="tab"]')),
    );
    const tabs = new Map<WorkspaceTabName, HTMLElement>();

    for (const tabName of orderedTabNames) {
      const wrapper = getTabWrapper(tablist, tabIconSelectors[tabName]);
      if (wrapper) tabs.set(tabName, wrapper);
    }

    const gitWrapper = getTabWrapper(tablist, tabIconSelectors.git);
    if (gitWrapper) {
      gitWrapper.hidden = true;
      if (gitWrapper.querySelector('[aria-selected="true"]')) {
        tabs.get('chat')?.querySelector<HTMLButtonElement>('button[role="tab"]')?.click();
      }
    }

    const libraryWrapper = tabs.get('library');
    const libraryButton = libraryWrapper?.querySelector<HTMLButtonElement>('button[role="tab"]');
    if (libraryButton) {
      libraryButton.setAttribute('aria-label', 'Bibliothèque');
      const libraryLabel = libraryButton.querySelector<HTMLSpanElement>('span');
      if (libraryLabel && libraryLabel.textContent !== 'Bibliothèque') libraryLabel.textContent = 'Bibliothèque';
    }

    const orderedWrappers = orderedTabNames.flatMap((tabName) => {
      const wrapper = tabs.get(tabName);
      return wrapper ? [wrapper] : [];
    });
    const pluginWrappers = wrappers.filter((wrapper) => !orderedWrappers.includes(wrapper) && wrapper !== gitWrapper);
    const separators = Array.from(tablist.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && !wrappers.includes(child),
    );
    const nextChildren = [...orderedWrappers, ...separators, ...pluginWrappers, ...(gitWrapper ? [gitWrapper] : [])];
    const currentChildren = Array.from(tablist.children);

    if (nextChildren.some((child, index) => currentChildren[index] !== child)) {
      for (const child of nextChildren) tablist.appendChild(child);
    }
  }
};

const scheduleWorkspaceTabLayout = (() => {
  let frameId: number | null = null;

  return (): void => {
    if (frameId !== null) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      applyWorkspaceTabLayout();
    });
  };
})();

const workspaceTabObserver = new MutationObserver(scheduleWorkspaceTabLayout);
workspaceTabObserver.observe(document.body, { childList: true, subtree: true });
scheduleWorkspaceTabLayout();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    workspaceTabObserver.disconnect();
  });
}
