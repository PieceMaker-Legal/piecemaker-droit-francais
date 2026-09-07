import { useSyncExternalStore } from 'react';

import { MikeViewer } from '@/piecemaker/mike/MikeViewer';
import { useMikePage } from '@/piecemaker/mike/page';
import { subscribeWorkflowSessionBridge, workflowSessionBridge } from '@/piecemaker/mike/sessionBridge';

export function MikeWorkspaceOverlay() {
  const page = useMikePage();
  const { projectPath } = useSyncExternalStore(subscribeWorkflowSessionBridge, workflowSessionBridge);

  if (!page) return null;

  return (
    <div data-pm-mike-overlay="true" className="fixed inset-0 z-40 bg-background">
      <MikeViewer projectPath={projectPath ?? null} />
    </div>
  );
}
