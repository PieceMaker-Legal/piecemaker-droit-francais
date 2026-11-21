import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, ChevronDown, ChevronRight, Hourglass, Loader2 } from 'lucide-react';

import type { QuotaLimit } from '@piecemaker/quota-limit';
import { LLMProviderLogo } from '@/shared/ui';
import type { ScheduledMessage } from '@/shared/types';
import { ProviderModelList } from '@/modules/piecemaker-quota/ProviderModelList';
import { useProviderCatalogs } from '@/modules/piecemaker-quota/hooks/useProviderCatalogs';
import { useQuotaPreferences } from '@/modules/piecemaker-quota/hooks/useQuotaPreferences';
import {
  PROVIDER_NAMES,
  cancelResumes,
  formatDelay,
  formatResumeTime,
  handOffSession,
  listPendingResumes,
  markHandled,
  nextChainEntry,
  resumeTime,
  scheduleResume,
  wasHandled,
} from '@/modules/piecemaker-quota/utils/quotaResume';
import type { QuotaChainEntry } from '@/modules/piecemaker-quota/utils/quotaResume';

type QuotaLimitCardProps = {
  limit: QuotaLimit;
  provider: string;
  sessionId: string | null;
  noticeAt: Date;
  interactive?: boolean;
};

const AUTO_HANDOFF_WINDOW_MS = 15 * 60_000;

function modelLabel(catalogs: ReturnType<typeof useProviderCatalogs>, entry: QuotaChainEntry): string {
  return catalogs?.[entry.provider]?.OPTIONS.find((option) => option.value === entry.model)?.label || entry.model;
}

type QuotaLimitActionsProps = { provider: string; sessionId: string; noticeTime: number; resumeTime: number };

function QuotaLimitActions({ provider, sessionId, noticeTime, resumeTime: resumeAtTime }: QuotaLimitActionsProps) {
  const navigate = useNavigate();
  const { preferences } = useQuotaPreferences();
  const [pickerOpen, setPickerOpen] = useState(false);
  const catalogs = useProviderCatalogs();
  const [pending, setPending] = useState<ScheduledMessage[] | null>(null);
  const [busy, setBusy] = useState<'schedule' | 'handoff' | null>(null);
  const [error, setError] = useState('');
  const handledKey = `${sessionId}:${noticeTime}`;
  const next = preferences ? nextChainEntry(preferences.chain, provider) : null;

  const refreshPending = useCallback(async () => {
    try {
      setPending(await listPendingResumes(sessionId));
    } catch {
      setPending([]);
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const setAutoResume = useCallback(async (enabled: boolean) => {
    setBusy('schedule');
    setError('');
    try {
      if (enabled) await scheduleResume(sessionId, provider, new Date(resumeAtTime));
      else await cancelResumes(pending ?? []);
      markHandled(handledKey);
      await refreshPending();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [handledKey, pending, provider, refreshPending, resumeAtTime, sessionId]);

  const handOff = useCallback(async (target: QuotaChainEntry) => {
    setBusy('handoff');
    setError('');
    try {
      markHandled(handledKey);
      const nextSessionId = await handOffSession(sessionId, provider, target);
      navigate(`/session/${nextSessionId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  }, [handledKey, navigate, provider, sessionId]);

  useEffect(() => {
    if (!preferences || pending === null || busy || wasHandled(handledKey)) return;
    if (preferences.mode === 'wait' && pending.length === 0 && resumeAtTime > Date.now()) {
      void setAutoResume(true);
    } else if (preferences.mode === 'chain' && next && Date.now() - noticeTime < AUTO_HANDOFF_WINDOW_MS) {
      void handOff(next);
    }
  }, [busy, handOff, handledKey, next, noticeTime, pending, preferences, resumeAtTime, setAutoResume]);

  const scheduled = pending?.[0] ? new Date(pending[0].scheduledFor) : null;

  return (
    <div className="mt-3 space-y-3 pl-11">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-amber-600"
          checked={Boolean(scheduled)}
          disabled={pending === null || busy !== null}
          onChange={(event) => void setAutoResume(event.target.checked)}
        />
        <span>
          Reprendre automatiquement quand la limite est levée
          {scheduled && <span className="block text-xs text-muted-foreground">Reprise programmée {formatResumeTime(scheduled)} dans cette session.</span>}
        </span>
        {busy === 'schedule' && <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {next && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handOff(next)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'handoff' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LLMProviderLogo provider={next.provider} className="h-3.5 w-3.5" />}
            Reprendre avec {PROVIDER_NAMES[next.provider]} · {modelLabel(catalogs, next)}
          </button>
        )}
        <button
          type="button"
          disabled={busy !== null}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          {next ? 'Autre modèle' : 'Reprendre avec un autre modèle'}
          {pickerOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      </div>

      {pickerOpen && (
        <div className="rounded-lg border border-border/60 bg-background p-3">
          <p className="mb-2 text-xs text-muted-foreground">Une nouvelle session s’ouvre dans ce dossier avec le modèle choisi ; elle reçoit la fin de cette conversation pour continuer le travail.</p>
          <ProviderModelList catalogs={catalogs} limitedProvider={provider} disabled={busy !== null} onSelect={(entry) => void handOff(entry)} />
        </div>
      )}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function QuotaLimitCard({ limit, provider, sessionId, noticeAt, interactive = true }: QuotaLimitCardProps) {
  const noticeTime = noticeAt.getTime();
  const resumeAt = useMemo(() => resumeTime(limit.resetAt, new Date(noticeTime)), [limit.resetAt, noticeTime]);
  const providerName = PROVIDER_NAMES[provider as keyof typeof PROVIDER_NAMES] ?? provider;

  return (
    <div data-quota-limit-card className="my-1 w-full max-w-xl rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 font-sans dark:border-amber-400/30 dark:bg-amber-400/5">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Hourglass className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <LLMProviderLogo provider={provider} className="h-4 w-4" />
            Limite d’utilisation de {providerName} atteinte
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {limit.resetAt
              ? <>Levée prévue {formatResumeTime(limit.resetAt)}{limit.resetAt.getTime() > Date.now() ? ` (dans ${formatDelay(limit.resetAt)})` : ''}.</>
              : <>Heure de levée inconnue : nouvel essai proposé {formatResumeTime(resumeAt)}.</>}
          </p>
        </div>
      </div>

      {interactive && sessionId && <QuotaLimitActions provider={provider} sessionId={sessionId} noticeTime={noticeTime} resumeTime={resumeAt.getTime()} />}

      <details className="mt-3 pl-11 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Message du fournisseur</summary>
        <p className="mt-1 whitespace-pre-wrap break-words">{limit.notice}</p>
      </details>
    </div>
  );
}
