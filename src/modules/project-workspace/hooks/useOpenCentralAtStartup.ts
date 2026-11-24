import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { requestJson } from '@/shared/authToken';

let handled = false;

/** PieceMaker s'ouvre sur l'agent central : une fois par chargement, quand l'adresse ne vise ni session ni dossier. */
export function useOpenCentralAtStartup(navigate: NavigateFunction, ready: boolean, idle: boolean) {
  useEffect(() => {
    if (handled || !ready) return;
    handled = true;
    if (!idle) return;
    requestJson<{ sessionId: string }>('/api/piecemaker/orchestrateur/central/session', {})
      .then(({ sessionId }) => { if (sessionId && window.location.pathname === '/') navigate(`/session/${sessionId}`, { replace: true }); })
      .catch(() => undefined);
  }, [navigate, ready, idle]);
}
