import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { desktopUninstallBridge } from '@/piecemaker/desktop/desktopUninstallBridge';

export function DesktopUninstallTab() {
  const { t } = useTranslation('settings');
  const bridge = desktopUninstallBridge();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!bridge) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Trash2 className="h-5 w-5 text-destructive" />
          <h3 className="text-lg font-medium text-foreground">{t('uninstall.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('uninstall.hint')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-sm font-medium text-destructive"
              onClick={() => {
                setFailed(false);
                void bridge.uninstall().catch(() => setFailed(true));
              }}
            >
              {t('uninstall.confirm')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border/60 px-3.5 py-2 text-sm text-muted-foreground"
              onClick={() => setConfirming(false)}
            >
              {t('uninstall.cancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded-lg border border-destructive/40 px-3.5 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => {
              setFailed(false);
              setConfirming(true);
            }}
          >
            {t('uninstall.action')}
          </button>
        )}
      </div>
      {failed ? <p className="text-xs text-destructive">{t('uninstall.failed')}</p> : null}
    </div>
  );
}
