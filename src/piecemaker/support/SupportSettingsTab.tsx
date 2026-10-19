import { useState } from 'react';
import { Copy, Download, LifeBuoy, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { pmSend } from '@/piecemaker/dossier/api';

type SupportReport = { filename: string; content: string };

const buttonClass = 'inline-flex items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50';

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Used by the settings module: the "Assistance" tab, which prepares a reviewable support report. */
export function SupportSettingsTab() {
  const { t } = useTranslation('settings');
  const [description, setDescription] = useState('');
  const [report, setReport] = useState<SupportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const prepare = async () => {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      setReport(await pmSend<SupportReport>('POST', '/support/report', { description }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('assistance.failed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(report.content);
    setCopied(true);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <LifeBuoy className="h-5 w-5 text-foreground" />
          <h3 className="text-lg font-medium text-foreground">{t('assistance.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('assistance.hint')}</p>
      </div>

      <div className="space-y-3">
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('assistance.placeholder')}
          rows={5}
          className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground"
        />
        <button type="button" className={buttonClass} onClick={() => void prepare()} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? t('assistance.preparing') : t('assistance.prepare')}
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {report && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('assistance.review')}</p>
          <textarea
            value={report.content}
            onChange={(event) => setReport({ ...report, content: event.target.value })}
            rows={16}
            spellCheck={false}
            className="w-full rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-xs text-foreground"
            data-testid="support-report"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={() => downloadText(report.filename, report.content)}>
              <Download className="h-4 w-4" />
              {t('assistance.download')}
            </button>
            <button type="button" className={buttonClass} onClick={() => void copy()}>
              <Copy className="h-4 w-4" />
              {copied ? t('assistance.copied') : t('assistance.copy')}
            </button>
          </div>
          <p className="text-sm text-muted-foreground">{t('assistance.send')}</p>
        </div>
      )}
    </div>
  );
}
