/**
 * Manual correction of a chronology piece's metadata (nature, date,
 * juridiction, free fields). PUT /repository/document-meta replaces the whole
 * override object at once (see document-index.cjs normalizeOverrideEntry): an
 * omitted field reverts to the auto-detected value, so the form always submits
 * every field together, never a partial diff (mirrors admin/app.js
 * chronologyMetaFormValues()).
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Check, FileText, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import { pmGet, pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { buildDocumentValueRegex, documentDateVariants } from '@/piecemaker/anonymizer/documentVerifier';
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

const CUSTOM_NATURE_VALUE = '__piecemaker_custom_nature__';
const CUSTOM_NATURES_STORAGE_KEY = 'piecemaker-custom-document-natures';
const NATURE_OPTIONS = [
  'assignation', 'conclusions', 'requête', 'courrier', 'courriel',
  'mise en demeure', 'contrat', 'facture', 'devis', 'attestation',
  'jugement', 'arrêt', 'ordonnance', 'procès-verbal', 'constat',
  'expertise', 'statuts de société', 'extrait Kbis', 'relevé bancaire',
  'acte notarié', 'bordereau de pièces',
];

const normalizedNature = (nature: string) => nature.trim().toLocaleLowerCase('fr');

function readCustomNatures(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CUSTOM_NATURES_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const known = new Set(NATURE_OPTIONS.map(normalizedNature));
    return parsed.filter((nature): nature is string => {
      if (typeof nature !== 'string' || !nature.trim()) return false;
      const normalized = normalizedNature(nature);
      if (known.has(normalized)) return false;
      known.add(normalized);
      return true;
    }).map((nature) => nature.trim());
  } catch {
    return [];
  }
}

function writeCustomNatures(natures: string[]) {
  try {
    window.localStorage.setItem(CUSTOM_NATURES_STORAGE_KEY, JSON.stringify(natures));
  } catch {}
}

type PreviewHighlightCategory = 'person' | 'date' | 'fact';

const PREVIEW_HIGHLIGHT_CLASSES: Record<PreviewHighlightCategory, string> = {
  person: 'rounded-sm bg-orange-400/40 px-0.5 text-foreground',
  date: 'rounded-sm bg-blue-400/40 px-0.5 text-foreground',
  fact: 'rounded-sm bg-yellow-300/50 px-0.5 text-foreground',
};

/**
 * Splits `text` into plain and highlighted segments, one pass per category in
 * priority order (person > date > fact, matching how the categories are
 * declared below) so a value matched by an earlier category is never
 * re-highlighted by a later one covering overlapping text.
 */
function highlightPreviewText(
  text: string,
  categories: Array<{ category: PreviewHighlightCategory; pattern: RegExp | null }>,
): Array<{ text: string; category: PreviewHighlightCategory | null }> {
  let segments: Array<{ text: string; category: PreviewHighlightCategory | null }> = [{ text, category: null }];
  for (const { category, pattern } of categories) {
    if (!pattern) continue;
    segments = segments.flatMap((segment) => {
      if (segment.category !== null) return [segment];
      const pieces: Array<{ text: string; category: PreviewHighlightCategory | null }> = [];
      let lastIndex = 0;
      pattern.lastIndex = 0;
      let match = pattern.exec(segment.text);
      while (match) {
        if (match.index > lastIndex) pieces.push({ text: segment.text.slice(lastIndex, match.index), category: null });
        pieces.push({ text: match[0], category });
        lastIndex = match.index + match[0].length;
        // Zero-length matches would loop forever; nudge forward.
        if (match[0].length === 0) pattern.lastIndex += 1;
        match = pattern.exec(segment.text);
      }
      if (lastIndex < segment.text.length) pieces.push({ text: segment.text.slice(lastIndex), category: null });
      return pieces.length ? pieces : [segment];
    });
  }
  return segments;
}

export default function CaseFilesDocumentMetaDialog({ caseId, document, entityOptions, onClose, onSaved }: CaseFilesDocumentMetaDialogProps) {
  const initialNature = document.nature?.trim() ?? '';
  const [rememberedNatures, setRememberedNatures] = useState(readCustomNatures);
  const initialKnownNature = [...NATURE_OPTIONS, ...rememberedNatures]
    .find((nature) => normalizedNature(nature) === normalizedNature(initialNature));
  const [natureSelection, setNatureSelection] = useState(
    initialKnownNature ? initialNature : initialNature ? CUSTOM_NATURE_VALUE : '',
  );
  const [customNature, setCustomNature] = useState(initialKnownNature ? '' : initialNature);
  const [dateIso, setDateIso] = useState(document.dateIso ?? '');
  const [localisation, setLocalisation] = useState(document.localisation ?? '');
  const [fields, setFields] = useState<ChronologyField[]>(document.fields.length ? document.fields : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  /** Retains the effective mapping codes while the user edits this piece. */
  const [selectedEntityCodes, setSelectedEntityCodes] = useState(() => document.codes.map(({ code }) => code));
  const sortedEntityOptions = useMemo(() => [...entityOptions].sort((left, right) => {
    const leftSelected = selectedEntityCodes.includes(left.code);
    const rightSelected = selectedEntityCodes.includes(right.code);
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    return left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' });
  }), [entityOptions, selectedEntityCodes]);
  const natureOptions = useMemo(() => {
    const options = [...NATURE_OPTIONS, ...rememberedNatures];
    if (initialKnownNature && initialKnownNature !== initialNature) {
      const index = options.indexOf(initialKnownNature);
      options[index] = initialNature;
    }
    return options;
  }, [initialKnownNature, initialNature, rememberedNatures]);

  // Highlight patterns for the preview panel, one per color category. Person
  // names come from the dossier-wide mapping (entityOptions) — every person
  // already known to this case, not just the ones currently checked for this
  // piece — so a mapped name is always shown in orange wherever it appears in
  // the text; dates reuse the same variant list the anonymizer verifier
  // matches against (ISO, DD/MM/YYYY, French long form, …); everything else
  // detected for this piece (nature, localisation, non-person entities, free
  // field values) is grouped under the generic "fact" category.
  const previewHighlightCategories = useMemo(() => {
    const personLabels = entityOptions.map((option) => option.label).filter(Boolean);
    const dateVariants = documentDateVariants(document.dateIso, document.date);
    const factValues = [
      ...document.codes
        .filter((entity) => entity.category !== 'personne')
        .map((entity) => entity.label || entityOptions.find((option) => option.code === entity.code)?.label || ''),
      document.nature,
      document.localisation,
      ...document.fields.flatMap((field) => [field.label, field.value]),
    ].filter((value): value is string => Boolean(value));
    return [
      { category: 'person' as const, pattern: buildDocumentValueRegex(personLabels) },
      { category: 'date' as const, pattern: buildDocumentValueRegex(dateVariants) },
      { category: 'fact' as const, pattern: buildDocumentValueRegex(factValues) },
    ];
  }, [document.codes, document.date, document.dateIso, document.fields, document.localisation, document.nature, entityOptions]);

  const previewSegments = useMemo(
    () => (previewContent !== null ? highlightPreviewText(previewContent, previewHighlightCategories) : []),
    [previewContent, previewHighlightCategories],
  );

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

  useEffect(() => {
    if (!document.path) {
      setPreviewLoading(false);
      setPreviewError('Cette pièce n’a pas de fichier d’origine.');
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewContent(null);
    pmGet<{ path: string; content: string }>('/repository/document', { case: caseId, path: document.path })
      .then((preview) => {
        if (cancelled) return;
        setPreviewContent(preview.content);
      })
      .catch((cause) => {
        if (cancelled) return;
        setPreviewError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, document.path]);

  const save = async () => {
    if (!document.path) {
      setError('Cette pièce n’a pas de fichier d’origine : correction indisponible.');
      return;
    }
    const nature = (natureSelection === CUSTOM_NATURE_VALUE ? customNature : natureSelection).trim();
    const isNewCustomNature = natureSelection === CUSTOM_NATURE_VALUE
      && nature
      && ![...NATURE_OPTIONS, ...rememberedNatures].some((option) => normalizedNature(option) === normalizedNature(nature));
    if (isNewCustomNature && window.confirm(`Mémoriser « ${nature} » dans le menu des types de pièce ?`)) {
      const nextRememberedNatures = [...rememberedNatures, nature];
      setRememberedNatures(nextRememberedNatures);
      writeCustomNatures(nextRememberedNatures);
    }

    setSaving(true);
    setError(null);
    try {
      const detectedCodes = document.detectedCodes.map(({ code }) => code);
      await pmPut('/repository/document-meta', {
        case: caseId,
        path: document.path,
        nature: nature || null,
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
      <DialogContent
        className="flex h-[85dvh] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-hidden p-0"
        data-piecemaker-identity-highlight="off"
      >
        <DialogTitle>Corriger les métadonnées de la pièce</DialogTitle>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col border-r border-border/50">
            <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-medium">{document.name}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-6 py-4">
              {previewLoading && (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement de la pièce…
                </div>
              )}
              {!previewLoading && previewError && (
                <p className="text-sm text-muted-foreground">{previewError}</p>
              )}
              {!previewLoading && !previewError && previewContent !== null && (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                  {previewSegments.map((segment, index) => (
                    <Fragment key={index}>
                      {segment.category ? (
                        <mark className={PREVIEW_HIGHLIGHT_CLASSES[segment.category]}>{segment.text}</mark>
                      ) : (
                        segment.text
                      )}
                    </Fragment>
                  ))}
                </pre>
              )}
            </div>
          </div>

          <div className="flex w-[380px] shrink-0 flex-col">
            <div className="shrink-0 border-b border-border/50 px-4 py-3">
              <h3 className="text-sm font-semibold">Corriger la pièce</h3>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 space-y-1 text-xs font-medium text-muted-foreground">
                  Type de pièce
                  <select
                    aria-label="Type de pièce"
                    value={natureSelection}
                    onChange={(event) => setNatureSelection(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">— Sélectionner —</option>
                    {natureOptions.map((nature) => <option key={nature} value={nature}>{nature}</option>)}
                    <option value={CUSTOM_NATURE_VALUE}>Autre type…</option>
                  </select>
                </label>
                {natureSelection === CUSTOM_NATURE_VALUE && (
                  <label className="col-span-2 space-y-1 text-xs font-medium text-muted-foreground">
                    Type personnalisé
                    <Input
                      value={customNature}
                      onChange={(event) => setCustomNature(event.target.value)}
                      placeholder="Ex. sommation de payer"
                      autoFocus
                    />
                  </label>
                )}
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
                <span className="text-xs font-medium text-muted-foreground">Personnes citées</span>
                <div className="flex flex-wrap gap-2 rounded-md border border-border/60 p-2">
                  {sortedEntityOptions.map((entity) => {
                    const selected = selectedEntityCodes.includes(entity.code);
                    return (
                      <Button
                        key={entity.code}
                        type="button"
                        variant={selected ? 'secondary' : 'outline'}
                        size="sm"
                        className={selected ? 'h-8' : 'h-8 opacity-80'}
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
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-border/50 px-4 py-3">
              <Button variant="outline" size="sm" onClick={onClose}>
                Annuler
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
