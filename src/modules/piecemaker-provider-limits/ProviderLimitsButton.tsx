import { Gauge, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { pmGet } from '@/piecemaker/dossier/api';
import { LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';

type LimitWindow = { id: 'five_hour' | 'seven_day'; usedPercent: number; resetsAt: string | null };

type ProviderLimits = { provider: 'claude' | 'codex' | 'mistral'; connected: boolean; windows: LimitWindow[]; message?: string };

const PROVIDER_NAMES: Record<ProviderLimits['provider'], string> = { claude: 'Claude', codex: 'Codex', mistral: 'Mistral' };
const WINDOW_NAMES: Record<LimitWindow['id'], string> = { five_hour: '5 h', seven_day: 'Semaine' };

function resetLabel(resetsAt: string | null) {
  if (!resetsAt) return '';
  const date = new Date(resetsAt);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `reprise ${sameDay ? `à ${time}` : `le ${date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} à ${time}`}`;
}

function barColor(percent: number) {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-amber-500';
  return 'bg-primary';
}

function WindowRow({ window }: { window: LimitWindow }) {
  const percent = Math.round(window.usedPercent);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{WINDOW_NAMES[window.id]}</span>
        <span className="text-muted-foreground">{percent} %{window.resetsAt ? ` · ${resetLabel(window.resetsAt)}` : ''}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${WINDOW_NAMES[window.id]} : ${percent} %`}>
        <div className={cn('h-full rounded-full', barColor(percent))} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

function ProviderSection({ limits }: { limits: ProviderLimits }) {
  return (
    <section className="space-y-2 py-2.5 first:pt-0 last:pb-0" aria-label={PROVIDER_NAMES[limits.provider]}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <LLMProviderLogo provider={limits.provider} className="h-4 w-4" />
        {PROVIDER_NAMES[limits.provider]}
        {!limits.connected && <span className="text-xs font-normal text-muted-foreground">non connecté</span>}
      </div>
      {limits.windows.map(window => <WindowRow key={window.id} window={window} />)}
      {limits.connected && limits.message && <p className="text-xs leading-snug text-muted-foreground">{limits.message}</p>}
    </section>
  );
}

export function ProviderLimitsButton() {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderLimits[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback((refresh: boolean) => {
    setLoading(true);
    setError(null);
    pmGet<{ data?: { providers?: ProviderLimits[] } }>('/provider-limits', refresh ? { refresh: 1 } : undefined)
      .then(payload => setProviders(payload.data?.providers ?? []))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), bottom: window.innerHeight - rect.top + 8 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !panelRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const toggle = () => {
    if (!open) load(false);
    setOpen(!open);
  };

  const visible = providers?.filter(limits => limits.connected) ?? [];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="Consommation des providers"
        title="Consommation des providers (5 h et semaine)"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Gauge className="h-3.5 w-3.5" />
      </button>
      {open && position && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Consommation des providers"
          className="fixed z-[1000] w-80 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          style={{ left: position.left, bottom: position.bottom }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Consommation</span>
            <button type="button" onClick={() => load(true)} disabled={loading} aria-label="Actualiser" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          {!error && providers && !visible.length && <p className="text-xs text-muted-foreground">Aucun provider connecté.</p>}
          {!error && !providers && loading && <p className="text-xs text-muted-foreground">Lecture de la consommation…</p>}
          <div className="divide-y divide-border/60">
            {visible.map(limits => <ProviderSection key={limits.provider} limits={limits} />)}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
