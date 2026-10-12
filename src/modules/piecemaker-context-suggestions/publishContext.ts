import type { WorkspaceContext } from '@/modules/piecemaker-context-suggestions/contextStore';
import { authenticatedFetch } from '@/shared/api';

const PUBLISH_DELAY_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
let published = '';

export function publishWorkspaceContext(context: WorkspaceContext) {
  if (!context.project) return;
  const body = JSON.stringify({ project: context.project, panels: context.panels, document: context.document, focus: context.focus, last: context.last });
  if (body === published) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    published = body;
    void authenticatedFetch('/api/piecemaker/volets-ouverts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {
      published = '';
    });
  }, PUBLISH_DELAY_MS);
}
