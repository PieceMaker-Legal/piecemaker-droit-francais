import { useState } from 'react';
import { Loader2, X } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import type { MappingDocument, MappingGroup, ProcedureParty } from '@/piecemaker/dossier/sections/MappingModel';
import { PartyFields } from '@/piecemaker/dossier/sections/ProcedurePartiesDialog';
import { validateProcedureParty } from '@/piecemaker/dossier/sections/procedurePartyValidation';

type ProfileSide = 'client' | 'adversaire';

type ProcedurePartyProfileDialogProps = {
  open: boolean;
  mapping: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>;
  group: MappingGroup;
  initialParty: ProcedureParty;
  initialSide: ProfileSide;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (side: ProfileSide, party: ProcedureParty) => Promise<void>;
};

const SELECT_CLASS = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function ProcedurePartyProfileDialog({ open, mapping, group, initialParty, initialSide, saving, onOpenChange, onSave }: ProcedurePartyProfileDialogProps) {
  const [party, setParty] = useState<ProcedureParty>(initialParty);
  const [side, setSide] = useState<ProfileSide>(initialSide);
  const [error, setError] = useState<string | null>(null);

  const updateParty = (_side: ProfileSide, _index: number, patch: Partial<ProcedureParty>) => {
    setParty((previous) => ({ ...previous, ...patch }));
    setError(null);
  };

  const submit = async () => {
    const validationError = validateProcedureParty(party);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      setError(null);
      await onSave(side, party);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogTitle>Modifier le profil</DialogTitle>
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Profil détecté</p><h2 className="text-lg font-semibold">{group.principal}</h2><p className="mt-1 text-xs text-muted-foreground">Modifiez uniquement cette personne ou société et sa position dans la procédure.</p></div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)} aria-label="Fermer"><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Camp</span>
            <select className={SELECT_CLASS} value={side} onChange={(event) => setSide(event.target.value as ProfileSide)}>
              <option value="client">Client</option>
              <option value="adversaire">Adverse</option>
            </select>
          </label>
          <PartyFields
            party={party}
            side={side}
            index={0}
            mapping={mapping}
            updateParty={updateParty}
            removeParty={() => undefined}
            showRemove={false}
          />
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-3">
          {error && <p className="mr-auto text-xs text-destructive">{error}</p>}
          {!error && <span className="mr-auto" />}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
          <Button size="sm" onClick={() => void submit()} disabled={saving}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
