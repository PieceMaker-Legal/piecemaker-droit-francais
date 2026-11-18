import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AppTab } from '@/shared/types';

const ANONYMIZATION_STATE_EVENT = 'piecemaker:anonymization-state';
const MAPPING_EVENT = 'piecemaker:mapping-show';
const MAPPING_KEY = '__piecemakerMappingShow';

type AnonymizationState = { project: string | null; anonymized: boolean; pending: boolean };

export function PanelAnonymizationButton({ tab }: { tab: AppTab }) {
  const [state, setState] = useState<AnonymizationState | null>(null);

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<AnonymizationState & { tab?: string }>).detail;
      if (detail?.tab === tab) setState({ project: detail.project, anonymized: Boolean(detail.anonymized), pending: Boolean(detail.pending) });
    };
    window.addEventListener(ANONYMIZATION_STATE_EVENT, sync);
    return () => window.removeEventListener(ANONYMIZATION_STATE_EVENT, sync);
  }, [tab]);

  if (!state) return null;
  const label = `${state.anonymized ? 'Dossier anonymisé' : 'Dossier non anonymisé'} — ${state.pending ? 'mapping à valider' : 'afficher le mapping'}`;
  const show = () => {
    (window as Window & { [MAPPING_KEY]?: string | null })[MAPPING_KEY] = state.project;
    window.dispatchEvent(new Event(MAPPING_EVENT));
  };
  return (
    <button type="button" className="piecemaker-panel-anonymization" data-anonymized={state.anonymized} data-pending={state.pending} aria-label={label} title={label} onClick={show}>
      {state.anonymized ? <ShieldCheck /> : <ShieldOff />}
    </button>
  );
}
