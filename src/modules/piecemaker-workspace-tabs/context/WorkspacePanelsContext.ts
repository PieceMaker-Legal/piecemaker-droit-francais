import { createContext, useContext } from 'react';

import type { AppTab } from '@/shared/types';

export const WorkspacePanelsContext = createContext<readonly AppTab[] | null>(null);

export function useOpenWorkspacePanels() {
  return useContext(WorkspacePanelsContext);
}
