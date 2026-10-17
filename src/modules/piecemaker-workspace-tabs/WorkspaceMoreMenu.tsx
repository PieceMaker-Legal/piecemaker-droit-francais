import { MoreVertical, RefreshCw, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { pmGet, pmPost } from '@/piecemaker/dossier/api';
import { refreshApplication } from '@/modules/piecemaker-workspace-tabs/refreshApplication';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

export type WorkspaceMoreMenuItem = { key: string; label: string; icon?: LucideIcon; onSelect: () => void };

type KeepAwakeState = { active: boolean };

const MENU_WIDTH = 280;

export function WorkspaceMoreMenu({ items, triggerClassName }: { items: WorkspaceMoreMenuItem[]; triggerClassName?: string }) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [keepAwake, setKeepAwake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = t('tabs.more', { defaultValue: 'Autres onglets' });
  const keepAwakeLabel = t('tabs.keepAwake', { defaultValue: 'Maintenir l’ordinateur actif' });

  useEffect(() => {
    if (!position) return;
    pmGet<KeepAwakeState>('/keep-awake').then((state) => setKeepAwake(state.active), () => undefined);
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setPosition(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPosition(null);
    };
    const close = () => setPosition(null);
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', close);
    };
  }, [position]);

  const toggleMenu = () => {
    if (position || !triggerRef.current) return setPosition(null);
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)) });
  };

  const toggleKeepAwake = async () => {
    setBusy(true);
    try {
      setKeepAwake((await pmPost<KeepAwakeState>('/keep-awake', { enabled: !keepAwake })).active);
    } finally {
      setBusy(false);
    }
  };

  const itemClass = 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:bg-accent';

  return (
    <>
      <Button ref={triggerRef} type="button" variant="ghost" size="icon" className={triggerClassName} aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={toggleMenu}>
        <MoreVertical className="h-4 w-4" />
      </Button>
      {position && createPortal(
        <div ref={menuRef} role="menu" data-escape-layer style={{ ...position, width: MENU_WIDTH }} className="fixed z-[70] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95">
          {items.map((item) => (
            <button key={item.key} type="button" role="menuitem" className={itemClass} onClick={() => { setPosition(null); item.onSelect(); }}>
              {item.icon && <item.icon className="h-4 w-4 flex-shrink-0" />}
              <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
            </button>
          ))}
          {items.length > 0 && <div className="mx-2 my-1 h-px bg-border" />}
          <button type="button" role="menuitem" disabled={refreshState === 'loading'} className={cn(itemClass, 'disabled:opacity-60')} onClick={async () => {
            setRefreshState('loading');
            try {
              await refreshApplication();
            } catch {
              setRefreshState('failed');
            }
          }}>
            <RefreshCw className={cn('h-4 w-4 flex-shrink-0', refreshState === 'loading' && 'animate-spin')} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium leading-5">{refreshState === 'loading' ? 'Actualisation…' : 'Actualiser PieceMaker'}</span>
              <span aria-live="polite" className="block text-xs leading-4 text-muted-foreground">{refreshState === 'failed' ? 'Connexion impossible. Vérifiez Tailscale et que l’ordinateur est allumé, puis réessayez.' : 'Dernière version de cet ordinateur, sans réinstallation'}</span>
            </span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={keepAwake} disabled={busy} className={cn(itemClass, 'disabled:opacity-60')} onClick={() => void toggleKeepAwake()}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium leading-5">{keepAwakeLabel}</span>
              <span className="block text-xs leading-4 text-muted-foreground">{t('tabs.keepAwakeHint', { defaultValue: 'Empêche la mise en veille tant que PieceMaker tourne' })}</span>
            </span>
            <span aria-hidden className={cn('relative h-5 w-9 flex-shrink-0 rounded-full transition-colors', keepAwake ? 'bg-primary' : 'bg-muted-foreground/30')}>
              <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all', keepAwake ? 'left-[18px]' : 'left-0.5')} />
            </span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
