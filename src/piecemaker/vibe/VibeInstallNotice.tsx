import { Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchVibeInstallState, requestVibeInstall } from '@/piecemaker/vibe/api';
import { Button } from '@/shared/ui';

type VibeInstallNoticeProps = {
  onInstalled: () => void;
};

type NoticeState = 'checking' | 'installed' | 'missing' | 'installing';

export function VibeInstallNotice({ onInstalled }: VibeInstallNoticeProps) {
  const [state, setState] = useState<NoticeState>('checking');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchVibeInstallState()
      .then((current) => {
        if (!active || !current) return;
        setState(current.installed ? 'installed' : current.installing ? 'installing' : 'missing');
        if (!current.installed && !current.installing && current.error) setError(current.error);
        if (current.installing) {
          return requestVibeInstall()
            .then(() => { if (active) setState('installed'); })
            .catch((caughtError: Error) => {
              if (!active) return;
              setError(caughtError.message);
              setState('missing');
            });
        }
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (state !== 'installing') return undefined;
    const timer = window.setInterval(() => {
      fetchVibeInstallState()
        .then((current) => setStep(current?.step ?? null))
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [state]);

  if (state === 'checking' || state === 'installed') return null;

  const install = async () => {
    setState('installing');
    setError(null);
    try {
      await requestVibeInstall();
      setState('installed');
      onInstalled();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      setState('missing');
    }
  };

  return (
    <div className="border-t border-border/50 pt-4" data-testid="vibe-install-notice">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-violet-700 dark:text-violet-300">
          {state === 'installing'
            ? `Installation de Mistral Vibe en cours, cela peut prendre quelques minutes…${step ? ` (${step})` : ''}`
            : 'Mistral Vibe n’est pas installé sur ce poste. PieceMaker peut l’installer pour vous.'}
        </div>
        <Button
          onClick={install}
          disabled={state === 'installing'}
          className="bg-violet-600 text-white hover:bg-violet-700 active:bg-violet-800"
          size="sm"
        >
          {state === 'installing'
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <Download className="mr-2 h-4 w-4" />}
          Installer Vibe
        </Button>
      </div>
      {error && (
        <pre className="mt-3 whitespace-pre-wrap text-sm text-red-600 dark:text-red-400">{error}</pre>
      )}
    </div>
  );
}
