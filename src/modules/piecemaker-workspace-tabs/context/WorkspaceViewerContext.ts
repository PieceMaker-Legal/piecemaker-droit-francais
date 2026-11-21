import { createContext } from 'react';
import type { MutableRefObject } from 'react';

export const WorkspaceViewerContext = createContext<{
  target: HTMLElement | null;
  tabsTarget: HTMLElement | null;
  register: (open: boolean) => void;
  closeRef?: MutableRefObject<(() => void) | null>;
  expanded: boolean;
  toggleExpand: () => void;
} | null>(null);
