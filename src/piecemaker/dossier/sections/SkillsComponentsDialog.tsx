/**
 * Dialog for registering PieceMaker's own skills/agents with Claude Code
 * (`GET /plugin/components`, `POST /plugin/install`) — the "legal plugin"
 * bundled with the repo, as opposed to the Claude marketplace handled by
 * `SkillsMarketplaceDialog`.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, TriangleAlert, X } from 'lucide-react';

import { Badge, Button, Dialog, DialogContent, DialogTitle, ScrollArea } from '@/shared/ui';

import { pmGet, pmPost, PieceMakerApiError } from '../api';
import type { ClaudeAssetState, PluginComponent } from './SkillsSection';

type ComponentsResponse = {
  plugin: { installed: boolean; version: string };
  components: PluginComponent[];
};

type InstallResponse = { ok: true; registered: string[]; removed: string[]; conflicts: string[] };

const STATE_BADGE: Record<ClaudeAssetState, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  linked: { label: 'Lié', variant: 'default' },
  copied: { label: 'Copié', variant: 'default' },
  stale: { label: 'Périmé', variant: 'secondary' },
  conflict: { label: 'Conflit', variant: 'destructive' },
  missing: { label: 'Non enregistré', variant: 'outline' },
};

type SkillsComponentsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
};

export default function SkillsComponentsDialog({ open, onOpenChange, onApplied }: SkillsComponentsDialogProps) {
  const [components, setComponents] = useState<PluginComponent[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    pmGet<ComponentsResponse>('/plugin/components')
      .then((response) => {
        setComponents(response.components);
        setSelected(new Set(response.components.filter((c) => c.registered).map((c) => c.path)));
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof PieceMakerApiError ? cause.message : 'Impossible de charger les composants.');
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setNotice(null);
    load();
  }, [open, load]);

  const close = () => {
    if (isSubmitting) return;
    onOpenChange(false);
  };

  const toggle = (path: string, conflict: boolean) => {
    if (conflict) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleApply = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const response = await pmPost<InstallResponse>('/plugin/install', { components: Array.from(selected) });
      setNotice(`${response.registered.length} enregistré(s), ${response.removed.length} retiré(s).`);
      onApplied();
      load();
    } catch (cause) {
      setSubmitError(cause instanceof PieceMakerApiError ? cause.message : 'Application impossible.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex h-[min(32rem,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-lg flex-col overflow-hidden p-0">
        <DialogTitle>Enregistrement Claude Code</DialogTitle>
        <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">Enregistrement Claude Code</h2>
            <p className="text-xs text-muted-foreground">Skills et agents PieceMaker à enregistrer auprès de Claude Code</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Fermer" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {loadError && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="space-y-1 p-4">
                {components.map((component) => {
                  const isConflict = component.state === 'conflict';
                  const badge = STATE_BADGE[component.state];
                  return (
                    <label
                      key={component.path}
                      className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${isConflict ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(component.path)}
                        disabled={isConflict}
                        onChange={() => toggle(component.path, isConflict)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">{component.name}</span>
                          <Badge variant={badge.variant} className="shrink-0 text-[10px]">{badge.label}</Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{component.description}</p>
                        {component.note && <p className="text-xs text-destructive">{component.note}</p>}
                      </div>
                    </label>
                  );
                })}
                {components.length === 0 && (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">Aucun skill ou agent PieceMaker trouvé.</p>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {submitError && <p className="mx-4 shrink-0 text-xs text-destructive">{submitError}</p>}
        {notice && !submitError && <p className="mx-4 shrink-0 text-xs text-foreground">{notice}</p>}

        <div className="flex shrink-0 justify-end gap-2 border-t border-border/50 px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={close} disabled={isSubmitting}>
            Fermer
          </Button>
          <Button type="button" size="sm" onClick={() => void handleApply()} disabled={isSubmitting || isLoading}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Appliquer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
