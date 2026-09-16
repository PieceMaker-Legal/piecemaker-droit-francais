const openChatAfterSidebarSelection = (event: MouseEvent) => {
  if (!(event.target instanceof Element) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const sessionLink = event.target.closest<HTMLAnchorElement>('a[href^="/session/"]');
  const compactSession = event.target.closest<HTMLElement>('div[class~="active:scale-[0.98]"]');
  const isSession = Boolean(sessionLink || (
    compactSession?.querySelector('div[title].truncate.text-sm.font-normal')
    && !event.target.closest('button, input, textarea, a')
  ));
  if (!isSession) return;

  window.setTimeout(() => {
    const icon = document.querySelector<SVGElement>('[role="tab"] svg.lucide-message-square');
    icon?.closest<HTMLButtonElement>('button[role="tab"]')?.click();
  });
};

document.addEventListener('click', openChatAfterSidebarSelection);

if (import.meta.hot) {
  import.meta.hot.dispose(() => document.removeEventListener('click', openChatAfterSidebarSelection));
}
