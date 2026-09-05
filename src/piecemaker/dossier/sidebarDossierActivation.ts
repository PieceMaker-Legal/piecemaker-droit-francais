const isAbsolutePath = (value: string): boolean => /^(?:\/|[A-Za-z]:[\\/])/.test(value);

const openTabAfterSidebarSelection = (event: MouseEvent) => {
  if (!(event.target instanceof Element) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const sessionLink = event.target.closest<HTMLAnchorElement>('a[href^="/session/"]');
  const compactSession = event.target.closest<HTMLElement>('div[class~="active:scale-[0.98]"]');
  const isSession = Boolean(sessionLink || (
    compactSession?.querySelector('div[title].truncate.text-sm.font-normal')
    && !event.target.closest('button, input, textarea, a')
  ));

  const projectButton = event.target.closest<HTMLButtonElement>('button');
  const projectPath = Array.from(projectButton?.querySelectorAll<HTMLElement>('[title]') ?? [])
    .find((element) => isAbsolutePath(element.title));
  if (!isSession && !projectPath) return;

  window.setTimeout(() => {
    const icon = document.querySelector<SVGElement>(isSession
      ? '[role="tab"] svg.lucide-message-square'
      : '[role="tab"] svg.lucide-scale');
    icon?.closest<HTMLButtonElement>('button[role="tab"]')?.click();
  });
};

document.addEventListener('click', openTabAfterSidebarSelection);

if (import.meta.hot) {
  import.meta.hot.dispose(() => document.removeEventListener('click', openTabAfterSidebarSelection));
}
