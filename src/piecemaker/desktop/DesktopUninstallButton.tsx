import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type PiecemakerDesktopBridge = {
  uninstall: () => Promise<unknown>;
};

function desktopBridge(): PiecemakerDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { piecemakerDesktop?: PiecemakerDesktopBridge }).piecemakerDesktop;
  return typeof bridge?.uninstall === 'function' ? bridge : null;
}

/** Rendered by the settings about tab when PieceMaker is the installed desktop app. */
export function DesktopUninstallButton() {
  const { t } = useTranslation('settings');
  const bridge = desktopBridge();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!bridge) return null;

  return (
    <div className="border-t border-border/50 pt-4">
      <p className="text-xs text-muted-foreground">{t('about.uninstallHint')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
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
              {t('about.uninstallConfirm')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border/60 px-3.5 py-2 text-sm text-muted-foreground"
              onClick={() => setConfirming(false)}
            >
              {t('about.uninstallCancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded-lg border border-border/60 px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={() => {
              setFailed(false);
              setConfirming(true);
            }}
          >
            {t('about.uninstall')}
          </button>
        )}
      </div>
      {failed ? <p className="mt-2 text-xs text-destructive">{t('about.uninstallFailed')}</p> : null}
    </div>
  );
}
