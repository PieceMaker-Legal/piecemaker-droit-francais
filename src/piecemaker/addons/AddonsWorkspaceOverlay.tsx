import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { AddonsViewer } from '@/piecemaker/addons/AddonsViewer';
import { useAddonsPage } from '@/piecemaker/addons/page';
import { subscribeWorkflowSessionBridge, workflowSessionBridge } from '@/piecemaker/addons/sessionBridge';

const WORKSPACE_REGION_SELECTOR = 'div.fixed.inset-0.flex.bg-background > div.flex.min-w-0.flex-1.flex-col';

export function AddonsWorkspaceOverlay() {
  const page = useAddonsPage();
  const hasPage = page !== null;
  const { projectPath } = useSyncExternalStore(subscribeWorkflowSessionBridge, workflowSessionBridge);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!hasPage) return;

    const region = document.querySelector<HTMLElement>(WORKSPACE_REGION_SELECTOR);
    const element = document.createElement('div');
    element.setAttribute('data-pm-addons-overlay', 'true');

    if (region) {
      element.className = 'flex min-h-0 flex-1 flex-col';
      const restoreDisplays: Array<() => void> = [];
      Array.from(region.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        const previousDisplay = child.style.display;
        child.style.display = 'none';
        restoreDisplays.push(() => { child.style.display = previousDisplay; });
      });
      region.appendChild(element);
      setHost(element);
      return () => {
        region.removeChild(element);
        restoreDisplays.forEach((restore) => restore());
        setHost(null);
      };
    }

    element.className = 'fixed inset-0 z-40 bg-background';
    document.body.appendChild(element);
    setHost(element);
    return () => {
      document.body.removeChild(element);
      setHost(null);
    };
  }, [hasPage]);

  if (!hasPage || !host) return null;

  return createPortal(<AddonsViewer projectPath={projectPath ?? null} />, host);
}
