import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, Smartphone, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { pmGet, pmPost } from '@/piecemaker/dossier/api';

export type RemoteStatus = {
  tailscale: { installed: boolean; running: boolean; httpsEnabled: boolean; dnsName: string | null };
  httpsPort: number;
  devMode: boolean;
  keepAwake: boolean;
  published: boolean;
  funnel: boolean;
  conflict: boolean;
  url: string | null;
  consentUrl?: string;
};

const TAILSCALE_WINDOWS_INSTALLER_URL = 'https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe';
const TAILSCALE_MAC_INSTALLER_URL = 'https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg';

function tailscaleInstallerUrl() {
  return /Windows/i.test(navigator.userAgent) ? TAILSCALE_WINDOWS_INSTALLER_URL : TAILSCALE_MAC_INSTALLER_URL;
}

const buttonClass = 'rounded-lg border border-border/60 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50';

function StateLine({ ok, children }: { ok: boolean; children: string }) {
  return (
    <p className={`inline-flex items-center gap-2 text-sm ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      {children}
    </p>
  );
}

export function RemoteAccessSettingsTab() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [consentUrl, setConsentUrl] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await pmGet<RemoteStatus>('/remote'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('remote.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError('');
    setConsentUrl('');
    try {
      const next = await pmPost<RemoteStatus>('/remote', { enabled });
      setStatus(next);
      if (next.consentUrl) setConsentUrl(next.consentUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  const tailscale = status?.tailscale;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Smartphone className="h-5 w-5 text-foreground" />
          <h3 className="text-lg font-medium text-foreground">{t('remote.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('remote.hint')}</p>
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 px-4 py-3">
        {!status && !error ? (
          <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            {t('remote.checking')}
          </span>
        ) : null}

        {tailscale && !tailscale.installed ? (
          <>
            <StateLine ok={false}>{t('remote.missing')}</StateLine>
            <a className={`${buttonClass} inline-flex items-center gap-2`} href={tailscaleInstallerUrl()} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {t('remote.install')}
            </a>
          </>
        ) : null}

        {tailscale?.installed && !tailscale.running ? <StateLine ok={false}>{t('remote.offline')}</StateLine> : null}

        {tailscale?.running ? (
          <>
            <StateLine ok>{t('remote.ready', { name: tailscale.dnsName })}</StateLine>
            {status.funnel ? <p className="text-sm text-destructive">{t('remote.funnel')}</p> : null}
            {status.conflict ? <p className="text-sm text-destructive">{t('remote.conflict', { port: status.httpsPort })}</p> : null}
            <div className="flex flex-wrap gap-2">
              {status.published ? (
                <button type="button" disabled={busy} className={buttonClass} onClick={() => void toggle(false)}>{t('remote.unpublish')}</button>
              ) : (
                <button type="button" disabled={busy || status.funnel || status.conflict} className={buttonClass} onClick={() => void toggle(true)}>
                  {busy ? t('remote.publishing') : t('remote.publish')}
                </button>
              )}
              {!status.published && !tailscale.httpsEnabled ? <p className="text-xs text-muted-foreground">{t('remote.httpsFirstTime')}</p> : null}
            </div>
          </>
        ) : null}

        {consentUrl ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground">{t('remote.consent')}</p>
            <a className={`${buttonClass} inline-flex items-center gap-2`} href={consentUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {t('remote.consentAction')}
            </a>
          </div>
        ) : null}

        {status?.url ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground">{t('remote.published')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-muted px-2 py-1 text-sm">{status.url}</code>
              <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} onClick={() => void copy(status.url!)}>
                <Copy className="h-4 w-4" />
                {copied ? t('remote.copied') : t('remote.copy')}
              </button>
            </div>
            {status.devMode ? <p className="text-xs text-muted-foreground">{t('remote.devMode')}</p> : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">{t('remote.phoneTitle')}</h4>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            {t('remote.step1')}{' '}
            <a className="underline" href={tailscaleInstallerUrl()} target="_blank" rel="noreferrer">{t('remote.installLink')}</a>
          </li>
          <li>{t('remote.httpsStep')}</li>
          <li>{t('remote.step2')}</li>
          <li>{t('remote.step3')}</li>
          <li>{t('remote.step4')}</li>
        </ol>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{t('remote.awake')}</p>
        <p>{t('remote.privacy')}</p>
        <p>{t('remote.machineName')}</p>
      </div>
    </div>
  );
}
