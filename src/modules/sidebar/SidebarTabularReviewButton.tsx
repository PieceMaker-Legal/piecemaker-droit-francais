import { useEffect, useState } from 'react';
import { Table } from 'lucide-react';
import type { TFunction } from 'i18next';

import { requestWorkspacePanel } from '@/modules/piecemaker-workspace-tabs';
import { api } from '@/shared/api';
import type { Project } from '@/shared/types';

const PLUGIN = 'piecemaker-tabular-review';
const OPEN_EVENT = 'piecemaker:tabular-review-open';
const PENDING_TARGET_KEY = '__piecemakerTabularReviewTarget';
const REFRESH_MS = 15_000;

let protectedProjects: { at: number; projects: Promise<Set<string>> } | null = null;

function readProtectedProjects(): Promise<Set<string>> {
  if (!protectedProjects || Date.now() - protectedProjects.at > REFRESH_MS) {
    const projects = Promise.resolve().then(() => api.plugins.rpc(PLUGIN, 'GET', '/protected-projects'))
      .then((response) => response.ok ? response.json() as Promise<{ projects?: unknown }> : {})
      .then((result: { projects?: unknown }) => new Set(Array.isArray(result.projects) ? result.projects.filter((entry): entry is string => typeof entry === 'string') : []))
      .catch(() => new Set<string>());
    protectedProjects = { at: Date.now(), projects };
  }
  return protectedProjects.projects;
}

type SidebarTabularReviewButtonProps = {
  className?: string;
  project: Project;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

export default function SidebarTabularReviewButton({ className, project, onNewSession, t }: SidebarTabularReviewButtonProps) {
  const [isProtected, setIsProtected] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => void readProtectedProjects().then((projects) => { if (alive) setIsProtected(projects.has(project.fullPath)); });
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [project.fullPath]);

  if (!isProtected) return null;

  return (
    <div className={className}>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        title={t('sessions.tabularReviewTitle')}
        onClick={() => {
          Object.assign(window, { [PENDING_TARGET_KEY]: project.fullPath });
          window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { project: project.fullPath } }));
          onNewSession(project);
          window.requestAnimationFrame(() => requestWorkspacePanel(`plugin:${PLUGIN}`));
        }}
      >
        <Table className="h-3 w-3" />
        {t('sessions.tabularReview')}
      </button>
    </div>
  );
}
