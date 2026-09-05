import { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import {
  PROCEDURE_POSITIONS,
  emptyProcedureParty,
  principalPartyOptions,
  type MappingDocument,
  type ProcedureInfo,
  type ProcedureParty,
} from '@/piecemaker/dossier/sections/MappingModel';

type PartySide = 'client' | 'adversaire';

type ProcedurePartiesDialogProps = {
  open: boolean;
  mapping: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>;
  initialInfo: ProcedureInfo;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (info: ProcedureInfo) => Promise<void>;
};

const INPUT_CLASS = 'h-8 text-xs';
const SELECT_CLASS = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
const LEGAL_FORMS = ['SAS', 'SASU', 'SARL', 'EURL', 'SA', 'SCI', 'SELARL', 'Association'];

function PartyFields({
  party,
  side,
  index,
  mapping,
  updateParty,
  removeParty,
}: {
  party: ProcedureParty;
  side: PartySide;
  index: number;
  mapping: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>;
  updateParty: (side: PartySide, index: number, patch: Partial<ProcedureParty>) => void;
  removeParty: (side: PartySide, index: number) => void;
}) {
  const options = useMemo(
    () => principalPartyOptions(mapping.mapping, mapping.reverse_mapping, party.type),
    [mapping, party.type],
  );
  const listId = `parties-${side}-${index}-${party.type}`;
  const legalFormsListId = `legal-forms-${side}-${index}`;

  return (
    <article className="space-y-3 rounded-lg border bg-background p-3 shadow-sm">
      <div className="grid grid-cols-[minmax(0,.85fr)_minmax(0,1fr)_2rem] items-end gap-2">
        <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
          <span>Nature</span>
          <select
            className={SELECT_CLASS}
            value={party.type}
            onChange={(event) => updateParty(side, index, { type: event.target.value as ProcedureParty['type'] })}
          >
            <option value="personne_physique">Personne physique</option>
            <option value="societe">Personne morale</option>
          </select>
        </label>
        <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
          <span>Position</span>
          <select
            className={SELECT_CLASS}
            value={party.position}
            onChange={(event) => updateParty(side, index, { position: event.target.value })}
          >
            {PROCEDURE_POSITIONS.map((position) => <option key={position.value} value={position.value}>{position.label}</option>)}
          </select>
        </label>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeParty(side, index)} aria-label="Supprimer cette partie">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {party.position === 'autre' && (
        <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">
          <span>Position personnalisée</span>
          <Input className={INPUT_CLASS} value={party.position_libelle} onChange={(event) => updateParty(side, index, { position_libelle: event.target.value })} placeholder="Ex. créancier poursuivant" />
        </label>
      )}

      {party.type === 'personne_physique' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Civilité</span>
            <select className={SELECT_CLASS} value={party.civilite} onChange={(event) => updateParty(side, index, { civilite: event.target.value })}>
              <option value="">—</option>
              {['M.', 'Mme', 'Mlle', 'Me', 'Dr'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="col-span-2 space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Nom complet — variant principal</span>
            <Input className={INPUT_CLASS} list={listId} value={party.nom} onChange={(event) => updateParty(side, index, { nom: event.target.value })} placeholder="Claire Reynaud" autoComplete="off" />
            <datalist id={listId}>{options.map((option) => <option key={option.code} value={option.principal}>{option.code}</option>)}</datalist>
          </label>
          <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Date de naissance</span>
            <Input className={INPUT_CLASS} value={party.date_naissance} onChange={(event) => updateParty(side, index, { date_naissance: event.target.value })} placeholder="12 septembre 1984" />
          </label>
          <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Lieu de naissance</span>
            <Input className={INPUT_CLASS} value={party.lieu_naissance} onChange={(event) => updateParty(side, index, { lieu_naissance: event.target.value })} placeholder="Lyon" />
          </label>
          <label className="col-span-2 space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Domicile</span>
            <Input className={INPUT_CLASS} value={party.adresse} onChange={(event) => updateParty(side, index, { adresse: event.target.value })} placeholder="12 rue…, 75000 Paris" />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Dénomination — variant principal</span>
            <Input className={INPUT_CLASS} list={listId} value={party.societe_nom} onChange={(event) => updateParty(side, index, { societe_nom: event.target.value })} placeholder="Société Alpha" autoComplete="off" />
            <datalist id={listId}>{options.map((option) => <option key={option.code} value={option.principal}>{option.code}</option>)}</datalist>
          </label>
          <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Forme sociale</span>
            <Input className={INPUT_CLASS} list={legalFormsListId} value={party.forme_sociale} onChange={(event) => updateParty(side, index, { forme_sociale: event.target.value })} placeholder="SAS" />
            <datalist id={legalFormsListId}>{LEGAL_FORMS.map((value) => <option key={value} value={value} />)}</datalist>
          </label>
          <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>SIREN</span>
            <Input className={INPUT_CLASS} inputMode="numeric" value={party.siren} onChange={(event) => updateParty(side, index, { siren: event.target.value })} placeholder="123 456 789" />
          </label>
          <label className="col-span-2 space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Siège social</span>
            <Input className={INPUT_CLASS} value={party.siege_social} onChange={(event) => updateParty(side, index, { siege_social: event.target.value })} placeholder="12 rue…, 75000 Paris" />
          </label>
          <label className="col-span-2 space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Représentant légal</span>
            <Input className={INPUT_CLASS} value={party.representant} onChange={(event) => updateParty(side, index, { representant: event.target.value })} placeholder="Mme Claire Reynaud" />
          </label>
        </div>
      )}
    </article>
  );
}

export default function ProcedurePartiesDialog({ open, mapping, initialInfo, saving, onOpenChange, onSave }: ProcedurePartiesDialogProps) {
  const [info, setInfo] = useState<ProcedureInfo>(initialInfo);
  const [error, setError] = useState<string | null>(null);

  const updateParty = (side: PartySide, index: number, patch: Partial<ProcedureParty>) => {
    const key = side === 'client' ? 'parties_clientes' : 'parties_adverses';
    setInfo((previous) => ({ ...previous, [key]: previous[key].map((party, partyIndex) => partyIndex === index ? { ...party, ...patch } : party) }));
    setError(null);
  };

  const addParty = (side: PartySide) => {
    const key = side === 'client' ? 'parties_clientes' : 'parties_adverses';
    setInfo((previous) => ({ ...previous, [key]: [...previous[key], emptyProcedureParty(side)] }));
  };

  const removeParty = (side: PartySide, index: number) => {
    const key = side === 'client' ? 'parties_clientes' : 'parties_adverses';
    setInfo((previous) => ({ ...previous, [key]: previous[key].filter((_, partyIndex) => partyIndex !== index) }));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setInfo(initialInfo);
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    try {
      for (const party of [...info.parties_clientes, ...info.parties_adverses]) {
        const identity = party.type === 'societe' ? party.societe_nom.trim() : party.nom.trim();
        if (!identity) throw new Error('Chaque partie ajoutée doit avoir un nom ou une dénomination.');
        if (party.position === 'autre' && !party.position_libelle.trim()) throw new Error('Précisez la position procédurale personnalisée.');
        if (party.type === 'societe' && party.siren && party.siren.replace(/\D/g, '').length !== 9) throw new Error('Le SIREN doit contenir exactement 9 chiffres.');
      }
      setError(null);
      await onSave(info);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const renderColumn = (side: PartySide, parties: ProcedureParty[]) => (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-t-4 bg-muted/30 ${side === 'client' ? 'border-t-emerald-600' : 'border-t-red-600'}`}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">{side === 'client' ? 'À gauche' : 'À droite'}</p><h3 className="text-sm font-semibold">Partie {side === 'client' ? 'cliente' : 'adverse'}</h3></div>
        <Button variant="ghost" size="sm" onClick={() => addParty(side)}><Plus className="h-3.5 w-3.5" /> Partie</Button>
      </div>
      <div className="min-h-[220px] flex-1 space-y-2 overflow-y-auto p-2">
        {parties.length ? parties.map((party, index) => <PartyFields key={`${side}-${index}`} party={party} side={side} index={index} mapping={mapping} updateParty={updateParty} removeParty={removeParty} />) : <p className="flex h-full items-center justify-center py-12 text-xs text-muted-foreground">Aucune partie {side === 'client' ? 'cliente' : 'adverse'}.</p>}
      </div>
    </section>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogTitle>Identifier les parties</DialogTitle>
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Procédure</p><h2 className="text-lg font-semibold">Identifier les parties</h2><p className="mt-1 text-xs text-muted-foreground">Choisissez un variant principal du mapping ou saisissez directement une nouvelle identité.</p></div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)} aria-label="Fermer"><X className="h-4 w-4" /></Button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2 md:overflow-hidden">
          {renderColumn('client', info.parties_clientes)}
          {renderColumn('adversaire', info.parties_adverses)}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-3">
          {error && <p className="mr-auto text-xs text-destructive">{error}</p>}
          {!error && <span className="mr-auto" />}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
          <Button size="sm" onClick={() => void submit()} disabled={saving}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Enregistrer les parties</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
