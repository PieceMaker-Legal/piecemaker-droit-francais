import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { pmGet, pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { ensureDossierRegistration } from '@/piecemaker/dossier/dossierRegistration';
import type { ProtectionBypassState } from '@/piecemaker/dossier/sections/CaseFilesTypes';

const LIFT_WARNING = 'Toutes les pièces PDF et images de ce dossier deviendront lisibles par l’IA, y compris celles déposées ensuite. Leur contenu ne sera plus remplacé par le Markdown anonymisé.';
const RESTORE_NOTICE = 'Les pièces PDF et images de ce dossier redeviendront illisibles pour l’IA, qui sera renvoyée vers leur Markdown anonymisé.';
const LIFTED_LABEL = 'Protection levée : l’IA lit les PDF et images de ce dossier. Cliquer pour la rétablir.';
const PROTECTED_HINT = 'Cliquer pour lever la protection du dossier.';

type CaseProtectionShieldProps = {
  projectPath: string;
  anonymized: boolean;
  anonymizedLabel: string;
};

function errorMessage(cause: unknown): string {
  return cause instanceof PieceMakerApiError ? cause.message : String(cause);
}

function isolate(event: SyntheticEvent) {
  event.stopPropagation();
}

export function CaseProtectionShield({ projectPath, anonymized, anonymizedLabel }: CaseProtectionShieldProps) {
  const [caseId, setCaseId] = useState<string | null>(null);
  const [state, setState] = useState<ProtectionBypassState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const { selectedCase } = await ensureDossierRegistration(projectPath);
      if (!selectedCase) return;
      setCaseId(selectedCase.path);
      setState(await pmGet<ProtectionBypassState>('/protection/bypass', { case: selectedCase.path }));
    } catch {
      setState(null);
    }
  }, [projectPath]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const lifted = state?.active ?? false;
  if (!anonymized && !lifted) return null;

  const openConfirmation = () => {
    if (!caseId || !state) return;
    setError(null);
    setConfirming(true);
  };

  const openFromKeyboard = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openConfirmation();
  };

  const applyToggle = async () => {
    if (!caseId) return;
    setSaving(true);
    setError(null);
    try {
      setState(await pmPut<ProtectionBypassState>('/protection/bypass', { case: caseId, active: !lifted }));
      setConfirming(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const label = lifted ? LIFTED_LABEL : `${anonymizedLabel}. ${PROTECTED_HINT}`;
  const ShieldIcon = lifted ? ShieldOff : ShieldCheck;

  return (
    <span className="inline-flex" onClick={isolate} onKeyDown={isolate}>
      <span
        role="switch"
        aria-checked={!lifted}
        aria-label={label}
        title={label}
        tabIndex={0}
        onClick={openConfirmation}
        onKeyDown={openFromKeyboard}
        className={cn(
          'flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors',
          lifted ? 'hover:bg-red-50 dark:hover:bg-red-900/20' : 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
        )}
      >
        <ShieldIcon className={cn('h-4 w-4', lifted ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300')} />
      </span>

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
    </span>
  );
}
