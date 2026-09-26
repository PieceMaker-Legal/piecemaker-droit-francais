import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { pmGet, pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { useDossierCases } from '@/piecemaker/dossier/DossierContext';
import type { ProtectionBypassState } from '@/piecemaker/dossier/sections/CaseFilesTypes';

const LIFT_WARNING = 'Toutes les pièces PDF et images de ce dossier deviendront lisibles par l’IA, y compris celles déposées ensuite. Leur contenu ne sera plus remplacé par le Markdown anonymisé.';
const RESTORE_NOTICE = 'Les pièces PDF et images de ce dossier redeviendront illisibles pour l’IA, qui sera renvoyée vers leur Markdown anonymisé.';

export default function CaseProtectionToggle() {
  const { selectedCaseId } = useDossierCases();
  const [state, setState] = useState<ProtectionBypassState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    if (!selectedCaseId) {
      setState(null);
      return;
    }
    try {
      setState(await pmGet<ProtectionBypassState>('/protection/bypass', { case: selectedCaseId }));
      setError(null);
    } catch (cause) {
      setState(null);
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    }
  }, [selectedCaseId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  if (!selectedCaseId) return null;

  const lifted = state?.active ?? false;

  const applyToggle = async () => {
    setSaving(true);
    setError(null);
    try {
      setState(await pmPut<ProtectionBypassState>('/protection/bypass', { case: selectedCaseId, active: !lifted }));
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Tooltip content={lifted ? 'Protection levée : l’IA lit les PDF et images de ce dossier.' : 'Dossier protégé : l’IA ne lit pas les PDF et images, elle est renvoyée vers le Markdown.'} position="bottom">
        <Button
          variant={lifted ? 'destructive' : 'ghost'}
          size="sm"
          role="switch"
          aria-checked={!lifted}
          disabled={!state}
          onClick={() => setConfirming(true)}
          className={cn('h-8 shrink-0 gap-1.5 px-2.5', lifted && 'font-semibold')}
        >
          {lifted ? <ShieldOff className="h-3.5 w-3.5 shrink-0" /> : <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{lifted ? 'Protection levée' : 'Protégé'}</span>
        </Button>
      </Tooltip>

      <Dialog open={confirming} onOpenChange={(open) => { if (!saving) setConfirming(open); }}>
        <DialogContent className="max-w-md p-5">
          <DialogTitle className="text-base font-semibold">
            {lifted ? 'Rétablir la protection du dossier ?' : 'Lever la protection du dossier ?'}
          </DialogTitle>
          <p className="mt-3 text-sm text-muted-foreground">{lifted ? RESTORE_NOTICE : LIFT_WARNING}</p>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setConfirming(false)}>
              Annuler
            </Button>
            <Button variant={lifted ? 'default' : 'destructive'} size="sm" disabled={saving} onClick={() => void applyToggle()} className="gap-1.5">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {lifted ? 'Rétablir la protection' : 'Lever la protection'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
