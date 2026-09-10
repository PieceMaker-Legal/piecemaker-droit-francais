/**
 * Manual correction of a chronology piece's metadata (nature, date,
 * juridiction, free fields). PUT /repository/document-meta replaces the whole
 * override object at once (see document-index.cjs normalizeOverrideEntry): an
 * omitted field reverts to the auto-detected value, so the form always submits
 * every field together, never a partial diff (mirrors admin/app.js
 * chronologyMetaFormValues()).
 */

import { useState } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import { pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';
import type { ChronologyDocument, ChronologyField } from '@/piecemaker/dossier/sections/CaseFilesTypes';

type ChronologyEntityOption = {
  code: string;
  label: string;
};

type CaseFilesDocumentMetaDialogProps = {
  caseId: string;
  document: ChronologyDocument;
  entityOptions: ChronologyEntityOption[];
  onClose: () => void;
  onSaved: () => void;
};

export default function CaseFilesDocumentMetaDialog({ caseId, document, entityOptions, onClose, onSaved }: CaseFilesDocumentMetaDialogProps) {
  const [nature, setNature] = useState(document.nature ?? '');
  const [dateIso, setDateIso] = useState(document.dateIso ?? '');
  const [localisation, setLocalisation] = useState(document.localisation ?? '');
  const [fields, setFields] = useState<ChronologyField[]>(document.fields.length ? document.fields : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Retains the effective mapping codes while the user edits this piece. */
  const [selectedEntityCodes, setSelectedEntityCodes] = useState(() => document.codes.map(({ code }) => code));

  const toggleEntity = (code: string) => {
    setSelectedEntityCodes((current) => current.includes(code)
      ? current.filter((selectedCode) => selectedCode !== code)
      : [...current, code]);
  };

  const updateField = (index: number, patch: Partial<ChronologyField>) => {
    setFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  };

  const removeField = (index: number) => {
    setFields((current) => current.filter((_, i) => i !== index));
  };

  const addField = () => {
    setFields((current) => [...current, { label: '', value: '' }]);
  };

  const save = async () => {
    if (!document.path) {
      setError('Cette pièce n’a pas de fichier d’origine : correction indisponible.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const detectedCodes = document.detectedCodes.map(({ code }) => code);
      await pmPut('/repository/document-meta', {
        case: caseId,
        path: document.path,
        nature: nature.trim() || null,
        dateIso: dateIso.trim() || null,
        localisation: localisation.trim() || null,
        fields: fields.filter((field) => field.label.trim() || field.value.trim()),
        entityDecisions: {
          additions: selectedEntityCodes.filter((code) => !detectedCodes.includes(code)),
          exclusions: detectedCodes.filter((code) => !selectedEntityCodes.includes(code)),
        },
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto p-5">
        <DialogTitle>Corriger les métadonnées de la pièce</DialogTitle>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Corriger la pièce</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{document.name}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 space-y-1 text-xs font-medium text-muted-foreground">
              Type de pièce
              <Input value={nature} onChange={(event) => setNature(event.target.value)} placeholder="Ex. Assignation" />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Date
              <Input type="date" value={dateIso} onChange={(event) => setDateIso(event.target.value)} />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Lieu
              <Input value={localisation} onChange={(event) => setLocalisation(event.target.value)} placeholder="Ex. TJ de Paris" />
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Personnes visées</span>
            <div className="flex flex-wrap gap-2 rounded-md border border-border/60 p-2">
              {entityOptions.map((entity) => {
                const selected = selectedEntityCodes.includes(entity.code);
                return (
                  <Button
                    key={entity.code}
                    type="button"
                    variant={selected ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-8"
                    aria-pressed={selected}
                    onClick={() => toggleEntity(entity.code)}
                  >
                    {selected && <Check className="h-3.5 w-3.5" />}
                    {entity.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Champs libres</span>
              <Button variant="ghost" size="sm" onClick={addField}>
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </Button>
            </div>
            {fields.length === 0 && <p className="text-xs text-muted-foreground">Aucun champ libre.</p>}
            {fields.map((field, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  className="w-1/3"
                  value={field.label}
                  onChange={(event) => updateField(index, { label: event.target.value })}
                  placeholder="Libellé"
                />
                <Input
                  className="flex-1"
                  value={field.value}
                  onChange={(event) => updateField(index, { value: event.target.value })}
                  placeholder="Valeur"
                />
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeField(index)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>
              Annuler
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
