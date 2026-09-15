import { useMemo } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import type { MappingCategory, MappingGroup } from '@/piecemaker/dossier/sections/MappingModel';
import { MAPPING_CATEGORIES, mappingCategoryForEntry, nextMappingCode } from '@/piecemaker/dossier/sections/MappingModel';

type CaseMappingDialogProps = {
  open: boolean;
  groups: MappingGroup[];
  saving: boolean;
  invalidRowIndex: number | null;
  onOpenChange: (open: boolean) => void;
  onPromote: (group: MappingGroup) => void;
  onChange: (groups: MappingGroup[]) => void;
  onSave: () => void;
};

const INPUT_CLASS = 'h-8 min-w-0 text-xs';

export default function CaseMappingDialog({ open, groups, saving, invalidRowIndex, onOpenChange, onChange, onSave, onPromote }: CaseMappingDialogProps) {
  const rowsByCategory = useMemo(() => {
    const buckets = new Map<MappingCategory, Array<{ group: MappingGroup; rowIndex: number }>>();
    groups.forEach((group, rowIndex) => {
      const category = mappingCategoryForEntry(group.code, group.principal);
      const bucket = buckets.get(category) || [];
      bucket.push({ group, rowIndex });
      buckets.set(category, bucket);
    });
    buckets.forEach((bucket) => {
      bucket.sort((left, right) => {
        if (!left.group.principal) return right.group.principal ? 1 : 0;
        if (!right.group.principal) return -1;
        return left.group.principal.localeCompare(right.group.principal, 'fr', { sensitivity: 'base' });
      });
    });
    return buckets;
  }, [groups]);

  const updateGroup = (rowIndex: number, patch: Partial<MappingGroup>) => {
    onChange(groups.map((group, index) => (index === rowIndex ? { ...group, ...patch } : group)));
  };

  const updateVariant = (rowIndex: number, variantIndex: number, value: string) => {
    const group = groups[rowIndex];
    if (!group) return;
    updateGroup(rowIndex, { variants: group.variants.map((variant, index) => (index === variantIndex ? value : variant)) });
  };

  const removeVariant = (rowIndex: number, variantIndex: number) => {
    const group = groups[rowIndex];
    if (!group) return;
    updateGroup(rowIndex, { variants: group.variants.filter((_, index) => index !== variantIndex) });
  };

  const addVariant = (rowIndex: number) => {
    const group = groups[rowIndex];
    if (!group) return;
    updateGroup(rowIndex, { variants: [...group.variants, ''] });
  };

  const removeGroup = (rowIndex: number) => {
    onChange(groups.filter((_, index) => index !== rowIndex));
  };

  const addGroup = (category: MappingCategory) => {
    onChange([...groups, { code: nextMappingCode(category, groups), principal: '', variants: [''] }]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogTitle className="border-b border-border px-5 py-4">Mapping de pseudonymisation</DialogTitle>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted-foreground">
            Chaque ligne associe une cle de pseudonymisation au variant principal retabli lors du revert et aux autres ecritures detectees.
          </p>
          {MAPPING_CATEGORIES.map((entry) => {
            const rows = rowsByCategory.get(entry.value) || [];
            return (
              <div key={entry.value} role="group" aria-label={entry.label} className="space-y-2">
                <header className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {entry.label}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{rows.length}</span>
                  </h3>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => addGroup(entry.value)}>
                    <Plus className="h-3.5 w-3.5" />
                    Ajouter
                  </Button>
                </header>
                {rows.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Aucune entree detectee.</p>
                ) : (
                  <div className="space-y-2">
                    {rows.map(({ group, rowIndex }) => (
                      <div
                        key={rowIndex}
                        className={`grid grid-cols-1 gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] ${invalidRowIndex === rowIndex ? 'border-destructive' : 'border-border'}`}
                      >
                        <Input
                          className={INPUT_CLASS}
                          value={group.code}
                          placeholder="PERSONNE_PHYSIQUE_01"
                          aria-label={`Cle de la ligne ${rowIndex + 1}`}
                          onChange={(event) => updateGroup(rowIndex, { code: event.target.value })}
                        />
                        <Input
                          className={INPUT_CLASS}
                          value={group.principal}
                          placeholder="Variant principal"
                          aria-label={`Variant principal de la ligne ${rowIndex + 1}`}
                          onChange={(event) => updateGroup(rowIndex, { principal: event.target.value })}
                        />
                        <div className="space-y-1">
                          {group.variants.map((variant, variantIndex) => (
                            <div key={variantIndex} className="flex items-center gap-1">
                              <Input
                                className={INPUT_CLASS}
                                value={variant}
                                placeholder="Autre ecriture detectee"
                                aria-label={`Variant ${variantIndex + 1} de la ligne ${rowIndex + 1}`}
                                onChange={(event) => updateVariant(rowIndex, variantIndex, event.target.value)}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                aria-label={`Supprimer le variant ${variantIndex + 1} de la ligne ${rowIndex + 1}`}
                                onClick={() => removeVariant(rowIndex, variantIndex)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => addVariant(rowIndex)}>
                            <Plus className="h-3.5 w-3.5" />
                            Variant
                          </Button>
                        </div>
                        <div className="flex items-start gap-1">
                        {(entry.value === 'personnes_physiques' || entry.value === 'societes') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 text-xs"
                            onClick={() => onPromote(group)}
                          >
                            Partie
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          aria-label={`Supprimer la ligne ${rowIndex + 1}`}
                          onClick={() => removeGroup(rowIndex)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Fermer</Button>
          <Button size="sm" className="gap-2" disabled={saving} onClick={onSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer le mapping
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
