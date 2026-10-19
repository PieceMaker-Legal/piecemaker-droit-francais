import { useState } from 'react';
import { Download, LifeBuoy, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { pmSend } from '@/piecemaker/dossier/api';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';

type SupportReport = { filename: string; content: string };

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Used by the sidebar module next to its settings button: opens the support request dialog. */
export function SupportButton({ className, iconClassName }: { className: string; iconClassName: string }) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    setBusy(true);
    setError('');
    setDownloaded(false);
    try {
      const report = await pmSend<SupportReport>('POST', '/support/report', { description });
      downloadText(report.filename, report.content);
      setDownloaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('assistance.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        aria-label={t('assistance.title')}
        title={t('assistance.title')}
      >
        <LifeBuoy className={iconClassName} />
      </button>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent className="max-w-lg space-y-4 p-5">
          <DialogTitle className="not-sr-only flex items-center gap-2 text-base font-semibold">
            <LifeBuoy className="h-4 w-4" />
            {t('assistance.title')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{t('assistance.hint')}</p>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('assistance.placeholder')}
            rows={5}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground"
          />
          {downloaded && <p className="text-sm text-emerald-600 dark:text-emerald-400">{t('assistance.downloaded')}</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              {t('assistance.cancel')}
            </Button>
            <Button size="sm" onClick={() => void download()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {busy ? t('assistance.preparing') : t('assistance.download')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
