import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { pmGet, pmPost } from '@/piecemaker/dossier/api';

type LocalModelId = 'gliner' | 'mineru';

type LocalModelStatus = { name: string; installed: boolean };

type InstallJob = { id: string; state: 'running' | 'done' | 'failed'; progress: string; error: string };

type Activity = { model: LocalModelId; progress: string } | null;

const LOCAL_MODEL_IDS: LocalModelId[] = ['gliner', 'mineru'];
const INSTALL_POLL_INTERVAL_MS = 1_500;

async function installLocalModel(model: LocalModelId, onProgress: (progress: string) => void): Promise<void> {
  let { job } = await pmPost<{ job: InstallJob }>('/configuration/install', { component: model });
  while (job.state === 'running') {
    onProgress(job.progress);
    await new Promise((resolve) => window.setTimeout(resolve, INSTALL_POLL_INTERVAL_MS));
    ({ job } = await pmGet<{ job: InstallJob }>('/configuration/install', { id: job.id }));
  }
  if (job.state === 'failed') throw new Error(job.error || 'Installation interrompue.');
}

export function LocalModelsSettingsTab() {
  const { t } = useTranslation('settings');
  const [models, setModels] = useState<Record<LocalModelId, LocalModelStatus> | null>(null);
  const [activity, setActivity] = useState<Activity>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<LocalModelId | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const { components } = await pmGet<{ components: Record<LocalModelId, LocalModelStatus> }>('/configuration');
      setModels(components);
    } catch {
      setError(t('localModels.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (model: LocalModelId, steps: { remove: boolean; install: boolean }) => {
    setConfirmingRemoval(null);
    setError('');
    try {
      if (steps.remove) {
        setActivity({ model, progress: t('localModels.removing') });
        await pmPost('/configuration/uninstall', { component: model });
      }
      if (steps.install) {
        setActivity({ model, progress: '' });
        await installLocalModel(model, (progress) => setActivity({ model, progress }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActivity(null);
      await refresh();
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Cpu className="h-5 w-5 text-foreground" />
          <h3 className="text-lg font-medium text-foreground">{t('localModels.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('localModels.hint')}</p>
      </div>
      <div className="space-y-3">
        {LOCAL_MODEL_IDS.map((model) => {
          const status = models?.[model];
          const busy = activity?.model === model;
          return (
            <div key={model} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {status?.name || model}
                  {status ? (
                    <span className={`inline-flex items-center gap-1 text-xs ${status.installed ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                      {status.installed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {status.installed ? t('localModels.installed') : t('localModels.missing')}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{busy && activity.progress ? activity.progress : t(`localModels.${model}`)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {models === null && !error ? (
                  <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    {t('localModels.checking')}
                  </span>
                ) : busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : confirmingRemoval === model ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive"
                      onClick={() => void run(model, { remove: true, install: false })}
                    >
                      {t('localModels.confirmRemove')}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground"
                      onClick={() => setConfirmingRemoval(null)}
                    >
                      {t('localModels.cancel')}
                    </button>
                  </>
                ) : status?.installed ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(activity)}
                      className="rounded-lg border border-border/60 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      onClick={() => void run(model, { remove: true, install: true })}
                    >
                      {t('localModels.reinstall')}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(activity)}
                      className="rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                      onClick={() => setConfirmingRemoval(model)}
                    >
                      {t('localModels.remove')}
                    </button>
                  </>
                ) : status ? (
                  <button
                    type="button"
                    disabled={Boolean(activity)}
                    className="rounded-lg border border-border/60 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                    onClick={() => void run(model, { remove: false, install: true })}
                  >
                    {t('localModels.install')}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
