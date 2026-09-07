import { ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge, Button, Pill, PillBar, ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';
import MarkdownPreview from '@/modules/code-editor/markdown/MarkdownPreview';
import { appendMikeWorkflowDraft } from '@/piecemaker/mike/ComposerActions';
import { setMikePage } from '@/piecemaker/mike/page';
import { MikeAsyncState } from '@/piecemaker/mike/pages/MikeAsyncState';
import { normalizeForSearch } from '@/piecemaker/mike/pages/searchText';
import type { MikeWorkflow, MikeWorkflowAddon, MikeWorkflowAddonDetail } from '@/piecemaker/mike/types';
import { useMikeData } from '@/piecemaker/mike/useMikeData';

type AddonSourceFilter = 'all' | 'mike' | 'claude-for-legal-fr';

const sizeFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function addonTypeLabel(type: MikeWorkflowAddon['type']): string {
  return type === 'assistant' ? 'Assistant' : 'Tabulaire';
}

function addonSource(packKey: string): Exclude<AddonSourceFilter, 'all'> {
  return packKey.startsWith('claude-for-legal-fr') ? 'claude-for-legal-fr' : 'mike';
}

function formatAssetSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return '—';
  if (sizeBytes < 1024) return `${sizeFormatter.format(sizeBytes)} o`;
  if (sizeBytes < 1024 * 1024) return `${sizeFormatter.format(sizeBytes / 1024)} ko`;
  return `${sizeFormatter.format(sizeBytes / (1024 * 1024))} Mo`;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

type AddonPack = { pack_key: string; pack_title: string; pack_description: string | null; addons: MikeWorkflowAddon[] };

export function AddonsPanel({ projectPath, search }: { projectPath: string | null; search: string }) {
  const { data, error, loading, reload } = useMikeData<MikeWorkflowAddon[]>('/workflow-addons');
  const [sourceFilter, setSourceFilter] = useState<AddonSourceFilter>('all');
  const [activePackKey, setActivePackKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const addons = data ?? [];
  const filtered = useMemo(() => {
    const needle = normalizeForSearch(search.trim());
    return addons.filter((addon) => {
      if (sourceFilter !== 'all' && addonSource(addon.pack_key) !== sourceFilter) return false;
      if (!needle) return true;
      const haystack = normalizeForSearch(`${addon.title} ${addon.description ?? ''} ${addon.pack_title} ${addon.practice ?? ''}`);
      return haystack.includes(needle);
    });
  }, [addons, sourceFilter, search]);

  const packs = useMemo(() => {
    const byPack = new Map<string, AddonPack>();
    for (const addon of filtered) {
      const group = byPack.get(addon.pack_key);
      if (group) {
        group.addons.push(addon);
      } else {
        byPack.set(addon.pack_key, { pack_key: addon.pack_key, pack_title: addon.pack_title, pack_description: addon.pack_description, addons: [addon] });
      }
    }
    return Array.from(byPack.values())
      .map((group) => ({ ...group, addons: [...group.addons].sort((a, b) => a.title.localeCompare(b.title)) }))
      .sort((a, b) => a.pack_title.localeCompare(b.pack_title));
  }, [filtered]);

  useEffect(() => {
    if (activePackKey && !packs.some((pack) => pack.pack_key === activePackKey)) setActivePackKey(null);
  }, [packs, activePackKey]);

  const activePack = activePackKey ? (packs.find((pack) => pack.pack_key === activePackKey) ?? null) : null;
  const packAddons = activePack?.addons ?? [];

  useEffect(() => {
    if (!activePack) {
      setSelectedId(null);
      return;
    }
    if (selectedId && packAddons.some((addon) => addon.id === selectedId)) return;
    setSelectedId(packAddons[0]?.id ?? null);
  }, [activePack, packAddons, selectedId]);

  const detail = useMikeData<MikeWorkflowAddonDetail>(selectedId ? `/workflow-addons/${selectedId}` : null);
  const selected = detail.data;
  const isEmpty = !loading && !error && (activePack ? packAddons.length === 0 : packs.length === 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/40 px-4 py-3">
        <PillBar>
          <Pill isActive={sourceFilter === 'all'} onClick={() => setSourceFilter('all')}>Toutes les sources</Pill>
          <Pill isActive={sourceFilter === 'mike'} onClick={() => setSourceFilter('mike')}>Mike</Pill>
          <Pill isActive={sourceFilter === 'claude-for-legal-fr'} onClick={() => setSourceFilter('claude-for-legal-fr')}>Claude for Legal France</Pill>
        </PillBar>
      </div>
      <MikeAsyncState
        loading={loading}
        loadingLabel="Chargement des add-ons…"
        error={error}
        onRetry={reload}
        empty={isEmpty}
        emptyLabel={addons.length === 0 ? 'Aucun add-on disponible.' : 'Aucun add-on ne correspond à ces filtres.'}
      />
      {!loading && !error && !isEmpty && !activePack && (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-1 p-2">
            {packs.map((pack) => (
              <li key={pack.pack_key}>
                <button
                  type="button"
                  onClick={() => setActivePackKey(pack.pack_key)}
                  className="flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{pack.pack_title}</span>
                    <Badge variant="outline">{pack.addons.length}</Badge>
                  </span>
                  {pack.pack_description && (
                    isHttpUrl(pack.pack_description) ? (
                      <a
                        href={pack.pack_description}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="truncate text-xs text-muted-foreground underline underline-offset-2"
                      >
                        {pack.pack_description}
                      </a>
                    ) : (
                      <span className="truncate text-xs text-muted-foreground">{pack.pack_description}</span>
                    )
                  )}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
      {!loading && !error && !isEmpty && activePack && (
        <div className="flex min-h-0 flex-1">
          <ScrollArea className="w-80 shrink-0 border-r border-border/40">
            <div className="flex flex-col gap-1 p-2">
              <Button size="sm" variant="ghost" onClick={() => setActivePackKey(null)} className="justify-start">
                <ChevronLeft className="h-4 w-4" />
                Retour aux packs
              </Button>
              <div className="px-3 py-1 text-xs font-medium text-muted-foreground">{activePack.pack_title}</div>
              <ul className="flex flex-col gap-1">
                {packAddons.map((addon) => (
                  <li key={addon.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(addon.id)}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent',
                        selectedId === addon.id && 'bg-accent',
                      )}
                    >
                      <span className="block truncate text-sm font-medium">{addon.title}</span>
                      {addon.description && (
                        <span className="block truncate text-xs text-muted-foreground">{addon.description}</span>
                      )}
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline">{addonTypeLabel(addon.type)}</Badge>
                        {addon.practice && <Badge variant="outline">{addon.practice}</Badge>}
                        {addon.language && <Badge variant="outline">{addon.language}</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </ScrollArea>
          <div className="flex min-h-0 flex-1 flex-col">
            {selected && (
              <>
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/40 px-4 py-3">
                  <div>
                    <h2 className="text-base font-semibold">{selected.title}</h2>
                    {selected.description && <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selected.practice && <Badge variant="secondary">{selected.practice}</Badge>}
                      {selected.language && <Badge variant="secondary">{selected.language}</Badge>}
                      {selected.jurisdictions?.map((jurisdiction) => (
                        <Badge key={jurisdiction} variant="secondary">{jurisdiction}</Badge>
                      ))}
                      {selected.version && <Badge variant="secondary">{selected.version}</Badge>}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {selected.pack_title}
                      {selected.pack_version ? ` · ${selected.pack_version}` : ''}
                      {selected.pack_description && (
                        isHttpUrl(selected.pack_description) ? (
                          <>
                            {' · '}
                            <a href={selected.pack_description} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                              {selected.pack_description}
                            </a>
                          </>
                        ) : (
                          ` · ${selected.pack_description}`
                        )
                      )}
                    </p>
                    {selected.contributors && selected.contributors.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selected.contributors.map((contributor) => contributor.organisation ? `${contributor.name} (${contributor.organisation})` : contributor.name).join(', ')}
                      </p>
                    )}
                    {selected.assets.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-muted-foreground">Ressources</p>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {selected.assets.map((asset) => (
                            <li key={asset.id} className="text-xs text-muted-foreground">
                              {asset.filename} — {formatAssetSize(asset.size_bytes)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  {projectPath && selected.type === 'assistant' && (
                    <Button
                      className="shrink-0"
                      onClick={() => {
                        const workflow: MikeWorkflow = {
                          id: selected.id,
                          metadata: {
                            title: selected.title,
                            description: selected.description,
                            type: selected.type,
                            practice: selected.practice,
                            language: selected.language ?? 'fr',
                            jurisdictions: selected.jurisdictions,
                          },
                          skill_md: selected.prompt_md,
                          columns_config: selected.columns_config,
                          created_at: selected.updated_at ?? '',
                        };
                        appendMikeWorkflowDraft(workflow);
                        setMikePage(null);
                      }}
                    >
                      Utiliser dans la session
                    </Button>
                  )}
                </div>
                <ScrollArea className="min-h-0 flex-1 px-4 py-3">
                  {selected.prompt_md ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <MarkdownPreview content={selected.prompt_md} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Aucune instruction disponible pour cet add-on.</p>
                  )}
                </ScrollArea>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
