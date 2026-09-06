/**
 * Case-wide protection switch for the "Pièces" view: one toggle that lifts the
 * vault on the case folder itself — every piece inside benefits, including the
 * ones filed later — and puts the per-piece classification back in charge when
 * switched off.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';

import { Button, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

import { pmGet, pmPut, PieceMakerApiError } from '../api';
import type { ProtectionBypassState } from './CaseFilesTypes';

type CaseFilesProtectionBypassProps = {
  caseId: string;
  onProtectionChange: () => void;
};

/** Used by CaseFilesOriginals, above the pieces mosaic it refreshes after each switch. */
export default function CaseFilesProtectionBypass({ caseId, onProtectionChange }: CaseFilesProtectionBypassProps) {
  const [state, setState] = useState<ProtectionBypassState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      setState(await pmGet<ProtectionBypassState>('/protection/bypass', { case: caseId }));
      setError(null);
    } catch (cause) {
      setState(null);
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    }
  }, [caseId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const active = state?.active ?? false;

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      setState(await pmPut<ProtectionBypassState>('/protection/bypass', { case: caseId, active: !active }));
      onProtectionChange();
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const hint = active
    ? `Protection levée sur le dossier : toutes ses pièces sont accessibles à l’IA, y compris celles déposées depuis. La rétablir rend la main au classement pièce par pièce (${state?.savedCount ?? 0} pièce(s) accessibles).`
    : 'Lève la protection sur le dossier lui-même : toutes ses pièces deviennent accessibles à l’IA, y compris celles déposées ensuite. Le classement pièce par pièce n’est pas modifié et reprend dès que le bouton est repassé.';

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Tooltip content={hint} position="top">
        <Button
          variant={active ? 'destructive' : 'outline'}
          size="sm"
          disabled={saving || (!state && !error)}
          onClick={() => void toggle()}
          aria-pressed={active}
          className={cn('gap-1.5', active && 'font-semibold')}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : active ? (
            <ShieldOff className="h-3.5 w-3.5" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {active ? 'Protection levée — rétablir' : 'Lever la protection du dossier'}
        </Button>
      </Tooltip>
    </div>
  );
}
