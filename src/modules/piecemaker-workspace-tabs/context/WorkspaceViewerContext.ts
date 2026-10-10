import { createContext } from 'react';

export const WorkspaceViewerContext = createContext<{
  target: HTMLElement | null;
  tabsTarget: HTMLElement | null;
  register: (open: boolean) => void;
  expanded: boolean;
  toggleExpand: () => void;
} | null>(null);
