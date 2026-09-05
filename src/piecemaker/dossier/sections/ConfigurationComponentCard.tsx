/**
 * One tile of the "Composants installés" grid in ConfigurationSection: status badge,
 * summary line, optional detail (`children`), and — for the two components the
 * backend can actually (re)install on demand, GLiNER and MinerU — an "Installer"
 * action that starts a job and polls it to completion.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui';
import { pmGet, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';

import { INSTALLABLE_COMPONENTS, type ConfigurationComponentKey, type ConfigurationInstallJob } from '@/piecemaker/dossier/sections/ConfigurationSection';

const POLL_INTERVAL_MS = 2500;

type Props = {
  componentKey: ConfigurationComponentKey;
  title: string;
  installed: boolean;
  summary: string;
  optional?: boolean;
  children?: ReactNode;
  /** Notifies the parent so it can reload `/configuration` once the install job succeeds. */
  onInstalled: () => void | Promise<void>;
};

export default function ConfigurationComponentCard({ componentKey, title, installed, summary, optional, children, onInstalled }: Props) {
  // Tracks the install job started from this card, so its progress/outcome survives
  // re-renders of the parent overview while polling.
  const [job, setJob] = useState<ConfigurationInstallJob | null>(null);
  // Surfaces a start failure (e.g. HTTP 409: another install already running) that
  // never produced a job to poll.
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startInstall = async () => {
    setStartError(null);
    try {
      const { job: started } = await pmPost<{ ok: boolean; job: ConfigurationInstallJob }>('/configuration/install', { component: componentKey });
      setJob(started);
      pollRef.current = setInterval(async () => {
        try {
          const { job: polled } = await pmGet<{ ok: boolean; job: ConfigurationInstallJob }>('/configuration/install', { id: started.id });
          setJob(polled);
          if (polled.state !== 'running') {
            stopPolling();
            if (polled.state === 'done') void onInstalled();
          }
        } catch (cause) {
          stopPolling();
          setJob((current) => current && { ...current, state: 'failed', error: cause instanceof PieceMakerApiError ? cause.message : String(cause) });
        }
      }, POLL_INTERVAL_MS);
    } catch (cause) {
      setStartError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    }
  };

  const installing = job?.state === 'running';
  const canInstall = !installed && INSTALLABLE_COMPONENTS.has(componentKey);

  return (
    <Card className="bg-muted/30">
      <CardHeader className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          {installed ? (
            <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Installé</Badge>
          ) : optional ? (
            <Badge variant="outline" className="gap-1"><CircleDashed className="h-3 w-3" />Optionnel</Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground"><CircleDashed className="h-3 w-3" />Absent</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </CardHeader>
      {(children || canInstall) && (
        <CardContent className="p-3 pt-0">
          {children}
          {canInstall && (
            <div className="mt-2">
              {job?.state === 'running' && (
                <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  {job.progress || 'Installation en cours…'}
                </p>
              )}
              {job?.state === 'failed' && (
                <p className="mb-2 text-xs text-destructive">{job.error || 'L’installation a échoué.'}</p>
              )}
              {startError && <p className="mb-2 text-xs text-destructive">{startError}</p>}
              <Button variant="outline" size="sm" onClick={() => void startInstall()} disabled={installing}>
                {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {installing ? 'Installation…' : 'Installer'}
              </Button>
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                L’installation continue même si vous quittez cet écran ; revenez ici pour suivre son avancement.
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
