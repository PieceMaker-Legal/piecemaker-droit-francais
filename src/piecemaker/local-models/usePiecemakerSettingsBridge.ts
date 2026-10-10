import { useEffect } from 'react';

import { usePaletteOps } from '@/modules/command-palette';

const OPEN_SETTINGS_EVENT = 'piecemaker:open-settings';

export function usePiecemakerSettingsBridge() {
  const { openSettings } = usePaletteOps();
  useEffect(() => {
    const open = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab;
      openSettings(typeof tab === 'string' && tab ? tab : undefined);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, [openSettings]);
}
