/**
 * Dialog for the Claude Code plugin marketplace (`GET /plugin/marketplace`,
 * `POST /plugin/marketplace/register`, `POST /plugin/marketplace/install`) —
 * two scopes, "legal" (claude-for-legal) and "official"
 * (claude-plugins-official). There is no remote search in the `claude` CLI:
 * filtering below is client-side over the fetched catalogue only.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search, TriangleAlert, X } from 'lucide-react';

import { Badge, Button, Dialog, DialogContent, DialogTitle, Input, Pill, PillBar, ScrollArea } from '@/shared/ui';

import { pmGet, pmPost, PieceMakerApiError } from '../api';
import type { MarketplacePlugin, MarketplaceScope } from './SkillsSection';

type MarketplaceResponse = {
  scope: string;
  marketplaceName: string;
  marketplaces: Array<{ name: string; repo: string | null; source: string | null; official: boolean }>;
  officialRegistered: boolean;
  registered: boolean;
  plugins: MarketplacePlugin[];
  reason?: string;
};

type InstallResponse = {
  ok: true;
  installed: number;
  enabled: number;
  disabled: number;
  failed: Array<{ id: string; reason?: string }>;
};

const SCOPES: { id: MarketplaceScope; label: string }[] = [
  { id: 'legal', label: 'Legal (claude-for-legal)' },
  { id: 'official', label: 'Officiel Anthropic' },
];

type SkillsMarketplaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function SkillsMarketplaceDialog({ open, onOpenChange }: SkillsMarketplaceDialogProps) {
  const [scope, setScope] = useState<MarketplaceScope>('legal');
  const [data, setData] = useState<MarketplaceResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((targetScope: MarketplaceScope) => {
    setIsLoading(true);
    setLoadError(null);
    pmGet<MarketplaceResponse>('/plugin/marketplace', { scope: targetScope })
      .then((response) => {
        setData(response);
        setSelected(new Set(response.plugins.filter((p) => p.installed && p.enabled).map((p) => p.id)));
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof PieceMakerApiError ? cause.message : 'Impossible de charger la marketplace.');
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSubmitError(null);
    setNotice(null);
    load(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, load]);

  const close = () => {
    if (isSubmitting) return;
    onOpenChange(false);
  };

  const handleRegister = async () => {
    setIsRegistering(true);
    setSubmitError(null);
    try {
      const response = await pmPost<{ ok: boolean; alreadyRegistered: boolean; reason?: string }>(
        '/plugin/marketplace/register',
        { scope },
      );
      if (!response.ok) setSubmitError(response.reason || 'Enregistrement du marketplace impossible.');
      load(scope);
    } catch (cause) {
      setSubmitError(cause instanceof PieceMakerApiError ? cause.message : 'Enregistrement du marketplace impossible.');
    } finally {
      setIsRegistering(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const response = await pmPost<InstallResponse>('/plugin/marketplace/install', {
        plugins: Array.from(selected),
        scope,
      });
      const failedCount = response.failed.length;
      setNotice(
        `${response.installed} installé(s), ${response.enabled} activé(s), ${response.disabled} désactivé(s)`
        + (failedCount > 0 ? `, ${failedCount} échec(s).` : '.'),
      );
      load(scope);
    } catch (cause) {
      setSubmitError(cause instanceof PieceMakerApiError ? cause.message : 'Application impossible.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const visiblePlugins = (data?.plugins ?? []).filter((plugin) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return plugin.name.toLowerCase().includes(needle) || plugin.description.toLowerCase().includes(needle);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex h-[min(36rem,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogTitle>Marketplace de plugins Claude</DialogTitle>
        <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">Marketplace de plugins Claude</h2>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Fermer" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-2">
          <PillBar role="tablist" aria-label="Marketplace" className="border border-border/40 bg-muted/50">
            {SCOPES.map((entry) => (
              <Pill
                key={entry.id}
                role="tab"
                aria-selected={scope === entry.id}
                isActive={scope === entry.id}
                onClick={() => setScope(entry.id)}
                className="h-7 px-2.5 text-xs"
              >
                {entry.label}
              </Pill>
            ))}
          </PillBar>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleRegister()} disabled={isRegistering}>
            {isRegistering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {data?.registered ? 'Rafraîchir le catalogue' : 'Découvrir…'}
          </Button>
        </div>

        {data && !data.registered && (
          <div className="mx-4 mt-2 flex shrink-0 items-start gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Ce marketplace n’est pas encore enregistré sur ce poste. Cliquez sur « Découvrir… » pour le déclarer et charger son catalogue.</span>
          </div>
        )}
        {data?.reason && (
          <div className="mx-4 mt-2 flex shrink-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{data.reason}</span>
          </div>
        )}
        {loadError && (
          <div className="mx-4 mt-2 flex shrink-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        <div className="shrink-0 px-4 pt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filtrer les plugins chargés…"
              className="pl-8"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement du catalogue… (peut prendre jusqu’à une minute)
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="space-y-1 p-4">
                {visiblePlugins.map((plugin) => (
                  <label key={plugin.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(plugin.id)}
                      onChange={() => toggle(plugin.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">{plugin.name}</span>
                        {plugin.installed && (
                          <Badge variant={plugin.enabled ? 'default' : 'secondary'} className="shrink-0 text-[10px]">
                            {plugin.enabled ? 'Actif' : 'Installé, désactivé'}
                          </Badge>
                        )}
                        {plugin.installCount !== null && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">{plugin.installCount} installations</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{plugin.description}</p>
                    </div>
                  </label>
                ))}
                {visiblePlugins.length === 0 && (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                    {data && data.plugins.length === 0 ? 'Aucun plugin dans ce catalogue.' : 'Aucun plugin ne correspond à la recherche.'}
                  </p>
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
          <Button type="button" size="sm" onClick={() => void handleApply()} disabled={isSubmitting || isLoading || !data?.registered}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Appliquer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
