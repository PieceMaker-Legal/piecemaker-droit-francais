import { createRoot } from 'react-dom/client';

import type { Project } from '@/shared/types';
import { AnonymizationLauncher } from '@/piecemaker/sidebar-anonymization/AnonymizationLauncher';
import { PseudonymizationSystem } from '@/modules/pseudonymization';

const ROOT_ID = 'piecemaker-sidebar-anonymization';
const SIDEBAR_SELECTOR = '.md\\:select-none';
const PROJECT_ITEM_SELECTOR = '.md\\:space-y-1';

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

function projectContent(project: Project): HTMLElement | null {
  const desktop = [...document.querySelectorAll<HTMLElement>('.min-w-0.flex-1.text-left[title]')]
    .find((element) => element.title === project.fullPath);
  if (desktop) return desktop;
  if (projects.filter((entry) => entry.displayName === project.displayName).length !== 1) return null;
  return [...document.querySelectorAll<HTMLElement>(`${SIDEBAR_SELECTOR} ${PROJECT_ITEM_SELECTOR} h3`)]
    .find((heading) => heading.textContent === project.displayName)?.parentElement ?? null;
}

function renderIntoSidebar(): void {
  const buttonSlots: HTMLElement[] = [];
  const systemSlots: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>(SIDEBAR_SELECTOR).forEach((sidebar) => {
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
      const row = parent.parentElement;
      if (!row) return;
      let systemSlot = row.querySelector<HTMLElement>(':scope > [data-piecemaker-pseudonymization-slot]');
      if (!systemSlot) {
        systemSlot = document.createElement('span');
        systemSlot.dataset.piecemakerPseudonymizationSlot = '';
        systemSlot.className = 'mr-auto';
        row.prepend(systemSlot);
      }
      systemSlots.push(systemSlot);
    });
  });

  const progressSlots = new Map<string, HTMLElement>();
  for (const project of projects) {
    const content = projectContent(project);
    if (!content) continue;
    content.closest<HTMLElement>(PROJECT_ITEM_SELECTOR)?.setAttribute('data-piecemaker-project-path', project.fullPath);
    let slot = content.querySelector<HTMLElement>(':scope > [data-piecemaker-project-progress]');
    if (!slot) {
      slot = document.createElement('div');
      slot.dataset.piecemakerProjectProgress = project.fullPath;
      content.appendChild(slot);
    }
    progressSlots.set(project.fullPath, slot);
  }

  root.render(<><PseudonymizationSystem buttonSlots={systemSlots} /><AnonymizationLauncher buttonSlots={buttonSlots} progressSlots={progressSlots} onProjectsChange={updateProjects} /></>);
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
    document.querySelectorAll('[data-piecemaker-anonymization-slot], [data-piecemaker-project-progress], [data-piecemaker-pseudonymization-slot]').forEach((element) => element.remove());
    document.querySelectorAll('[data-piecemaker-project-path]').forEach((element) => element.removeAttribute('data-piecemaker-project-path'));
  });
}
