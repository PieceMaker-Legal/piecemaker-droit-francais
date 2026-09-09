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
import { validateProcedureParty } from '@/piecemaker/dossier/sections/procedurePartyValidation';
import { procedurePositionFieldValue, procedurePositionPatch } from '@/piecemaker/dossier/sections/procedurePartyPosition';

type PartySide = 'client' | 'adversaire';

type ProcedurePartiesDialogProps = {
  open: boolean;
  mapping: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>;
  initialInfo: ProcedureInfo;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (info: ProcedureInfo) => Promise<void>;
};

const INPUT_CLASS = 'h-8 text-xs text-foreground';
const SELECT_CLASS = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
const LEGAL_FORMS = ['SAS', 'SASU', 'SARL', 'EURL', 'SA', 'SCI', 'SELARL', 'Association', 'GmbH', 'AG', 'Ltd', 'LLC', 'Inc.', 'PLC', 'Sàrl'];
const COUNTRIES = ['France', 'Allemagne', 'Belgique', 'Espagne', 'Italie', 'Luxembourg', 'Pays-Bas', 'Royaume-Uni', 'Suisse', 'États-Unis', 'Canada'];
const POSITION_LIST_ID = 'procedure-positions';

function isFrenchCountry(country: string): boolean {
  return ['france', 'français', 'francaise', 'française'].includes(country.trim().toLocaleLowerCase('fr'));
}

export function PartyFields({
  party,
  side,
  index,
  mapping,
  updateParty,
  removeParty,
  showRemove = true,
}: {
  party: ProcedureParty;
  side: PartySide;
  index: number;
  mapping: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>;
  updateParty: (side: PartySide, index: number, patch: Partial<ProcedureParty>) => void;
  removeParty: (side: PartySide, index: number) => void;
  showRemove?: boolean;
}) {
  const options = useMemo(
    () => principalPartyOptions(mapping.mapping, mapping.reverse_mapping, party.type),
    [mapping, party.type],
  );
  const listId = `parties-${side}-${index}-${party.type}`;
  const legalFormsListId = `legal-forms-${side}-${index}`;
  const countriesListId = `countries-${side}-${index}`;

  return (
    <article className="space-y-3 rounded-lg border bg-background p-3 shadow-sm">
      <div className={`grid items-end gap-2 ${showRemove ? 'grid-cols-[minmax(0,.85fr)_minmax(0,1fr)_2rem]' : 'grid-cols-2'}`}>
        <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
          <span>Nature</span>
          <select
            className={SELECT_CLASS}
            value={party.type}
            onChange={(event) => {
              const type = event.target.value as ProcedureParty['type'];
              updateParty(side, index, { type, pays: type === 'societe' ? party.pays || 'France' : '' });
            }}
          >
            <option value="personne_physique">Personne physique</option>
            <option value="societe">Personne morale</option>
          </select>
        </label>
        <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
          <span>Position</span>
          <Input
            className={SELECT_CLASS}
            list={`${POSITION_LIST_ID}-${side}-${index}`}
            value={procedurePositionFieldValue(party)}
            onChange={(event) => updateParty(side, index, procedurePositionPatch(event.target.value))}
            placeholder="demandeur, défendeur…"
          />
          <datalist id={`${POSITION_LIST_ID}-${side}-${index}`}>
            {PROCEDURE_POSITIONS.filter((position) => position.value !== 'autre').map((position) => <option key={position.value} value={position.value}>{position.label}</option>)}
          </datalist>
        </label>
        {showRemove && <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeParty(side, index)} aria-label="Supprimer cette partie">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>}
      </div>

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
            <span>Forme juridique — saisie libre</span>
            <Input className={INPUT_CLASS} list={legalFormsListId} value={party.forme_sociale} onChange={(event) => updateParty(side, index, { forme_sociale: event.target.value })} placeholder="SAS, GmbH, Ltd…" />
            <datalist id={legalFormsListId}>{LEGAL_FORMS.map((value) => <option key={value} value={value} />)}</datalist>
          </label>
          <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>Pays d’immatriculation</span>
            <Input className={INPUT_CLASS} list={countriesListId} value={party.pays} onChange={(event) => updateParty(side, index, { pays: event.target.value })} placeholder="France" autoComplete="country-name" />
            <datalist id={countriesListId}>{COUNTRIES.map((value) => <option key={value} value={value} />)}</datalist>
          </label>
          <label className="col-span-2 space-y-1 text-[11px] font-medium text-muted-foreground">
            <span>{isFrenchCountry(party.pays) ? 'SIREN' : 'Numéro d’immatriculation'}</span>
            <Input className={INPUT_CLASS} inputMode={isFrenchCountry(party.pays) ? 'numeric' : 'text'} value={party.siren} onChange={(event) => updateParty(side, index, { siren: event.target.value })} placeholder={isFrenchCountry(party.pays) ? '123 456 789' : 'Numéro de registre'} />
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
        const validationError = validateProcedureParty(party);
        if (validationError) throw new Error(validationError);
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
