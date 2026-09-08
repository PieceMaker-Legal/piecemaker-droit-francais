import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2, Users } from 'lucide-react';

import { pmGet, pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';
import {
  applyProcedureParties,
  buildMappingDocument,
  groupMappingByCode,
  MappingValidationError,
  normalizeProcedureInfo,
  procedureSummary,
  type MappingDocument,
  type MappingGroup,
  type ProcedureInfo,
} from '@/piecemaker/dossier/sections/MappingModel';
import ProcedurePartiesDialog from '@/piecemaker/dossier/sections/ProcedurePartiesDialog';
import { Button, Input } from '@/shared/ui';

type MappingResponse = Partial<MappingDocument> & {
  name: string;
  exists: boolean;
  commit?: { created?: boolean };
};

type InvalidField = {
  rowIndex?: number;
  field?: string;
  variant?: string;
};

type CaseMappingSectionProps = {
  caseId: string;
  onRepositoryChange: () => Promise<void>;
};

const INPUT_CLASS = 'h-8 min-w-0 text-xs';

function normalizedDocument(data: Partial<MappingDocument>): MappingDocument {
  return {
    mapping: data.mapping || {},
    reverse_mapping: data.reverse_mapping || {},
    informations_dossier: normalizeProcedureInfo(data.informations_dossier),
  };
}

export default function CaseMappingSection({ caseId, onRepositoryChange }: CaseMappingSectionProps) {
  const [document, setDocument] = useState<MappingDocument | null>(null);
  const [groups, setGroups] = useState<MappingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<InvalidField | null>(null);

  const loadMapping = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await pmGet<MappingResponse>('/mapping', { case: caseId });
      const nextDocument = normalizedDocument(data);
      setDocument(nextDocument);
      setGroups(groupMappingByCode(nextDocument.mapping, nextDocument.reverse_mapping));
      setMessage(data.exists ? null : 'Ce dossier n’a pas encore de fichier de mapping.');
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    let active = true;
    pmGet<MappingResponse>('/mapping', { case: caseId })
      .then((data) => {
        if (!active) return;
        const nextDocument = normalizedDocument(data);
        setDocument(nextDocument);
        setGroups(groupMappingByCode(nextDocument.mapping, nextDocument.reverse_mapping));
        setMessage(data.exists ? null : 'Ce dossier n’a pas encore de fichier de mapping.');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseId]);

  const updateGroup = (rowIndex: number, patch: Partial<MappingGroup>) => {
    setGroups((previous) => previous.map((group, index) => index === rowIndex ? { ...group, ...patch } : group));
    setInvalid(null);
    setMessage(null);
  };

  const updateVariant = (rowIndex: number, variantIndex: number, value: string) => {
    setGroups((previous) => previous.map((group, index) => index === rowIndex
      ? { ...group, variants: group.variants.map((variant, position) => position === variantIndex ? value : variant) }
      : group));
    setInvalid(null);
    setMessage(null);
  };

  const removeVariant = (rowIndex: number, variantIndex: number) => {
    setGroups((previous) => previous.map((group, index) => index === rowIndex
      ? { ...group, variants: group.variants.filter((_, position) => position !== variantIndex) }
      : group));
  };

  const currentMapping = () => {
    try {
      setInvalid(null);
      return buildMappingDocument(groups);
    } catch (cause) {
      if (cause instanceof MappingValidationError) setInvalid({ rowIndex: cause.rowIndex, field: cause.field, variant: cause.variant });
      throw cause;
    }
  };

  const saveDocument = async (nextDocument: MappingDocument, successMessage: string) => {
    const data = await pmPut<MappingResponse>('/mapping', { case: caseId, ...nextDocument });
    const saved = normalizedDocument(data);
    setDocument(saved);
    setGroups(groupMappingByCode(saved.mapping, saved.reverse_mapping));
    setMessage(`${successMessage}${data.commit?.created ? ' et commité' : ''}.`);
    await onRepositoryChange();
  };

  const saveMapping = async () => {
    if (!document) return;
    setSaving(true);
    setError(null);
    try {
      const mapping = currentMapping();
      await saveDocument({ ...mapping, informations_dossier: document.informations_dossier }, 'Mapping enregistré');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const openParties = () => {
    try {
      currentMapping();
      setError(null);
      setPartiesOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveParties = async (info: ProcedureInfo) => {
    if (!document) return;
    setSaving(true);
    try {
      const mapping = currentMapping();
      const assigned = applyProcedureParties(mapping, document.informations_dossier, info);
      await saveDocument(assigned, 'Parties enregistrées');
      setPartiesOpen(false);
      setError(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Chargement du mapping…</div>;
  if (!document) return <div className="mx-auto max-w-md py-16 text-center text-sm"><p className="text-destructive">{error || 'Mapping indisponible.'}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void loadMapping()}>Réessayer</Button></div>;

  const summary = procedureSummary(document.informations_dossier);

  return (
    <div className="space-y-4 p-4">
      <button type="button" className="grid w-full grid-cols-[1fr_auto_1fr_auto] items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40" onClick={openParties}>
        <span className="min-w-0"><small className="block text-[10px] font-semibold uppercase text-emerald-600">Partie cliente</small><strong className={`block truncate text-sm ${summary.client.length ? '' : 'text-muted-foreground'}`}>{summary.client.length ? summary.client.join(' · ') : 'À renseigner'}</strong></span>
        <span className="font-semibold text-muted-foreground">c/</span>
        <span className="min-w-0"><small className="block text-[10px] font-semibold uppercase text-red-600">Partie adverse</small><strong className={`block truncate text-sm ${summary.adverse.length ? '' : 'text-muted-foreground'}`}>{summary.adverse.length ? summary.adverse.join(' · ') : 'À renseigner'}</strong></span>
        <span className="flex items-center gap-1 text-xs font-medium text-primary"><Users className="h-3.5 w-3.5" />Détails</span>
      </button>

      <p className="text-xs text-muted-foreground">Chaque ligne regroupe un nom anonymisé, le variant principal rétabli lors du revert et toutes les autres écritures détectées. Toute modification enregistrée crée automatiquement un commit limité au fichier de mapping.</p>

      <div className="overflow-hidden rounded-xl border">
        <div className="hidden grid-cols-[minmax(0,.9fr)_minmax(0,1fr)_minmax(0,1.35fr)_2rem] gap-2 border-b bg-muted/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
          <span>Nom anonymisé</span><span>Variant principal (revert)</span><span>Autres variants</span><span />
        </div>
        <div className="max-h-[52vh] divide-y overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-4 py-12 text-center text-xs text-muted-foreground">Aucune entrée. Ajoutez-en une ou régénérez depuis les scans PII.</p>
          ) : groups.map((group, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-1 gap-2 p-3 md:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)_minmax(0,1.35fr)_2rem] md:items-start">
              <label className="space-y-1"><span className="text-[10px] font-semibold uppercase text-muted-foreground md:hidden">Nom anonymisé</span><Input className={`${INPUT_CLASS} ${invalid?.rowIndex === rowIndex && invalid.field === 'code' ? 'border-destructive' : ''}`} value={group.code} onChange={(event) => updateGroup(rowIndex, { code: event.target.value })} placeholder="PERSONNE_PHYSIQUE_01" /></label>
              <label className="space-y-1"><span className="text-[10px] font-semibold uppercase text-muted-foreground md:hidden">Variant principal</span><Input className={`${INPUT_CLASS} ${invalid?.rowIndex === rowIndex && invalid.field === 'principal' ? 'border-destructive' : ''}`} value={group.principal} onChange={(event) => updateGroup(rowIndex, { principal: event.target.value })} placeholder="Jean Dupont" /></label>
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground md:hidden">Autres variants</span>
                {group.variants.map((variant, variantIndex) => <div key={variantIndex} className="flex gap-1"><Input className={`${INPUT_CLASS} ${invalid?.rowIndex === rowIndex && invalid.field === 'variant' && invalid.variant === variant ? 'border-destructive' : ''}`} value={variant} onChange={(event) => updateVariant(rowIndex, variantIndex, event.target.value)} placeholder="M. Dupont" /><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeVariant(rowIndex, variantIndex)} aria-label="Supprimer ce variant"><Trash2 className="h-3 w-3" /></Button></div>)}
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary" onClick={() => updateGroup(rowIndex, { variants: [...group.variants, ''] })}><Plus className="h-3 w-3" />Variant</Button>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setGroups((previous) => previous.filter((_, index) => index !== rowIndex))} aria-label="Supprimer cette entrée"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setGroups((previous) => [...previous, { code: '', principal: '', variants: [] }])}><Plus className="h-3.5 w-3.5" />Entrée</Button>
        <span className={`text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || message}</span>
        <Button size="sm" className="ml-auto" onClick={() => void saveMapping()} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Enregistrer le mapping</Button>
      </div>

      {partiesOpen && <ProcedurePartiesDialog open mapping={currentMappingSafe(groups)} initialInfo={document.informations_dossier} saving={saving} onOpenChange={setPartiesOpen} onSave={saveParties} />}
    </div>
  );
}

function currentMappingSafe(groups: MappingGroup[]): Pick<MappingDocument, 'mapping' | 'reverse_mapping'> {
  try {
    return buildMappingDocument(groups);
  } catch {
    return { mapping: {}, reverse_mapping: {} };
  }
}
