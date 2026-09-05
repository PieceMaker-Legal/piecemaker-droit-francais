const isAbsolutePath = (value: string): boolean => /^(?:\/|[A-Za-z]:[\\/])/.test(value);

const openDossierAfterProjectSelection = (event: MouseEvent) => {
  if (!(event.target instanceof Element)) return;

  const projectButton = event.target.closest<HTMLButtonElement>('button');
  const projectPath = Array.from(projectButton?.querySelectorAll<HTMLElement>('[title]') ?? [])
    .find((element) => isAbsolutePath(element.title));
  if (!projectPath) return;

  window.setTimeout(() => {
    const dossierIcon = document.querySelector<SVGElement>('[role="tab"] svg.lucide-scale');
    dossierIcon?.closest<HTMLButtonElement>('button[role="tab"]')?.click();
  });
};

document.addEventListener('click', openDossierAfterProjectSelection);

if (import.meta.hot) {
  import.meta.hot.dispose(() => document.removeEventListener('click', openDossierAfterProjectSelection));
}
