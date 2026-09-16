import { createRoot, type Root } from 'react-dom/client';

import { DossierCasesProvider } from '@/piecemaker/dossier/DossierContext';

import StampingSection from './StampingSection';
import type { PluginAPI } from './types';

type MountedPlugin = { root: Root; unsubscribe: () => void };

const mounted = new Map<HTMLElement, MountedPlugin>();

function projectPathOf(api: PluginAPI): string | null {
  return api.context.project?.path || null;
}

function render(root: Root, projectPath: string | null): void {
  root.render(
    <DossierCasesProvider projectPath={projectPath}>
      <StampingSection />
    </DossierCasesProvider>,
  );
}

export function mount(container: HTMLElement, api: PluginAPI): void {
  unmount(container);

  const root = createRoot(container);
  let currentProjectPath = projectPathOf(api);
  render(root, currentProjectPath);

  const unsubscribe = api.onContextChange((context) => {
    const nextProjectPath = context.project?.path || null;
    if (nextProjectPath === currentProjectPath) return;
    currentProjectPath = nextProjectPath;
    render(root, currentProjectPath);
  });

  mounted.set(container, { root, unsubscribe });
}

export function unmount(container: HTMLElement): void {
  const instance = mounted.get(container);
  if (!instance) return;
  mounted.delete(container);
  instance.unsubscribe();
  instance.root.unmount();
}
