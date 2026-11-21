import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { pmGet, pmPut } from '@/piecemaker/dossier/api';
import type { LLMProvider } from '@/shared/types';
import { ProviderModelList } from '@/modules/piecemaker-quota/ProviderModelList';
import { useProviderCatalogs } from '@/modules/piecemaker-quota/hooks/useProviderCatalogs';
import type { ProviderCatalogs } from '@/modules/piecemaker-quota/hooks/useProviderCatalogs';
import { handOffSession } from '@/modules/piecemaker-quota/utils/quotaResume';
import type { QuotaChainEntry } from '@/modules/piecemaker-quota/utils/quotaResume';

type ProviderSwitchSectionProps = {
  provider: string;
  sessionId: string | null;
  projectPath: string | null;
  onPickForNewChat: (provider: LLMProvider, model: string) => void;
  onDone: () => void;
};

const AGENT_PROVIDERS: LLMProvider[] = ['claude', 'codex', 'mistral'];

export function ProviderSwitchSection({ provider, sessionId, projectPath, onPickForNewChat, onDone }: ProviderSwitchSectionProps) {
  const navigate = useNavigate();
  const catalogs = useProviderCatalogs();
  const [agentSession, setAgentSession] = useState<boolean | null>(sessionId ? null : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId || !projectPath) return;
    let alive = true;
    pmGet<{ sessionId: string | null }>('/orchestrateur/session', { project: projectPath })
      .then((result) => { if (alive) setAgentSession(result.sessionId === sessionId); })
      .catch(() => { if (alive) setAgentSession(false); });
    return () => { alive = false; };
  }, [projectPath, sessionId]);

  const others = useMemo<ProviderCatalogs | null>(() => {
    if (!catalogs) return null;
    return Object.fromEntries(Object.entries(catalogs).filter(([key]) => key !== provider && (!agentSession || AGENT_PROVIDERS.includes(key as LLMProvider)))) as ProviderCatalogs;
  }, [agentSession, catalogs, provider]);

  const pick = async (entry: QuotaChainEntry) => {
    if (!sessionId) {
      onPickForNewChat(entry.provider, entry.model);
      onDone();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (agentSession && projectPath) {
        await pmPut('/orchestrateur/settings', { project: projectPath, orchestratorProvider: entry.provider, orchestratorModel: entry.model });
        onDone();
      } else {
        const nextSessionId = await handOffSession(sessionId, provider, entry, 'switch');
        onDone();
        navigate(`/session/${nextSessionId}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const hint = !sessionId
    ? null
    : agentSession
      ? 'L’agent passe au modèle choisi dès votre prochain message.'
      : 'Une nouvelle session s’ouvre dans ce dossier avec le modèle choisi ; elle reçoit la fin de cette conversation.';

  return (
    <div className="max-h-72 overflow-y-auto px-2.5 py-2" data-provider-switch>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changer de fournisseur</p>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      {agentSession === null ? <p className="py-2 text-xs text-muted-foreground">Chargement…</p> : <ProviderModelList catalogs={others} disabled={busy} onSelect={(entry) => void pick(entry)} />}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
