import { createRoot } from 'react-dom/client';

import type { Project } from '@/shared/types';
import { AnonymizationLauncher } from '@/piecemaker/sidebar-anonymization/AnonymizationLauncher';

const ROOT_ID = 'piecemaker-sidebar-anonymization';

const host = document.createElement('div');
host.id = ROOT_ID;
document.body.appendChild(host);
const root = createRoot(host);
let frame = 0;
let projects: Project[] = [];

function updateProjects(refreshedProjects: Project[]): void {
  projects = refreshedProjects;
  scheduleRender();
}

function renderIntoSidebar(): void {
  const buttonSlots: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>('.md\\:w-72.md\\:select-none').forEach((sidebar) => {
    sidebar.querySelectorAll<HTMLElement>('button').forEach((button) => {
      if (!button.querySelector('.lucide-refresh-cw')) return;
      const parent = button.parentElement;
      if (!parent) return;
      let slot = parent.querySelector<HTMLElement>(':scope > [data-piecemaker-anonymization-slot]');
      if (!slot) {
        slot = document.createElement('span');
        slot.dataset.piecemakerAnonymizationSlot = String(buttonSlots.length);
        parent.insertBefore(slot, button);
      }
      buttonSlots.push(slot);
    });
  });

  const progressSlots = new Map<string, HTMLElement>();
  for (const project of projects) {
    const content = [...document.querySelectorAll<HTMLElement>('[title]')]
      .find((element) => element.title === project.fullPath && element.closest('.min-w-0.flex-1.text-left'))
      ?.closest<HTMLElement>('.min-w-0.flex-1.text-left');
    if (!content) continue;
    let slot = content.querySelector<HTMLElement>(':scope > [data-piecemaker-project-progress]');
    if (!slot) {
      slot = document.createElement('div');
      slot.dataset.piecemakerProjectProgress = project.fullPath;
      content.appendChild(slot);
    }
    progressSlots.set(project.fullPath, slot);
  }

  root.render(<AnonymizationLauncher buttonSlots={buttonSlots} progressSlots={progressSlots} onProjectsChange={updateProjects} />);
}

function scheduleRender(): void {
  window.cancelAnimationFrame(frame);
  frame = window.requestAnimationFrame(renderIntoSidebar);
}

const observer = new MutationObserver(scheduleRender);
observer.observe(document.body, { childList: true, subtree: true });

scheduleRender();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    observer.disconnect();
    window.cancelAnimationFrame(frame);
    root.unmount();
    host.remove();
    document.querySelectorAll('[data-piecemaker-anonymization-slot], [data-piecemaker-project-progress]').forEach((element) => element.remove());
  });
}
