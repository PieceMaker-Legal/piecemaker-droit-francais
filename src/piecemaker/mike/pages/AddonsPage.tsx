import { useEffect, useMemo, useState } from 'react';

import { Badge, Button, Input, Pill, PillBar, ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { appendMikeWorkflowDraft } from '@/piecemaker/mike/ComposerActions';
import { setMikePage } from '@/piecemaker/mike/page';
import { MikeAsyncState } from '@/piecemaker/mike/pages/MikeAsyncState';
import { normalizeForSearch } from '@/piecemaker/mike/pages/searchText';
import type { MikeWorkflow, MikeWorkflowAddon, MikeWorkflowAddonDetail } from '@/piecemaker/mike/types';
import { useMikeData } from '@/piecemaker/mike/useMikeData';

type AddonTypeFilter = 'all' | 'assistant' | 'tabular';
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

export function AddonsPage({ projectPath }: { projectPath: string | null }) {
  const { data, error, loading, reload } = useMikeData<MikeWorkflowAddon[]>('/workflow-addons');
  const [typeFilter, setTypeFilter] = useState<AddonTypeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<AddonSourceFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const addons = data ?? [];
  const filtered = useMemo(() => {
    const needle = normalizeForSearch(search.trim());
    return addons.filter((addon) => {
      if (typeFilter !== 'all' && addon.type !== typeFilter) return false;
      if (sourceFilter !== 'all' && addonSource(addon.pack_key) !== sourceFilter) return false;
      if (!needle) return true;
      const haystack = normalizeForSearch(`${addon.title} ${addon.description ?? ''}`);
      return haystack.includes(needle);
    });
  }, [addons, typeFilter, sourceFilter, search]);

  const groups = useMemo(() => {
    const byPack = new Map<string, { pack_key: string; pack_title: string; addons: MikeWorkflowAddon[] }>();
    for (const addon of filtered) {
      const group = byPack.get(addon.pack_key);
      if (group) {
        group.addons.push(addon);
      } else {
        byPack.set(addon.pack_key, { pack_key: addon.pack_key, pack_title: addon.pack_title, addons: [addon] });
      }
    }
    return Array.from(byPack.values())
      .map((group) => ({ ...group, addons: [...group.addons].sort((a, b) => a.title.localeCompare(b.title)) }))
      .sort((a, b) => a.pack_title.localeCompare(b.pack_title));
  }, [filtered]);

  useEffect(() => {
    if (selectedId && filtered.some((addon) => addon.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);

  const detail = useMikeData<MikeWorkflowAddonDetail>(selectedId ? `/workflow-addons/${selectedId}` : null);
  const selected = detail.data;
  const isEmpty = !loading && !error && filtered.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/40 px-4 py-3">
        <PillBar>
          <Pill isActive={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>Tous</Pill>
          <Pill isActive={typeFilter === 'assistant'} onClick={() => setTypeFilter('assistant')}>Assistant</Pill>
          <Pill isActive={typeFilter === 'tabular'} onClick={() => setTypeFilter('tabular')}>Tabulaire</Pill>
        </PillBar>
        <PillBar>
          <Pill isActive={sourceFilter === 'all'} onClick={() => setSourceFilter('all')}>Toutes les sources</Pill>
          <Pill isActive={sourceFilter === 'mike'} onClick={() => setSourceFilter('mike')}>Mike</Pill>
          <Pill isActive={sourceFilter === 'claude-for-legal-fr'} onClick={() => setSourceFilter('claude-for-legal-fr')}>Claude for Legal France</Pill>
        </PillBar>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un add-on…" className="max-w-xs" />
      </div>
      <MikeAsyncState
        loading={loading}
        loadingLabel="Chargement des add-ons…"
        error={error}
        onRetry={reload}
        empty={isEmpty}
        emptyLabel={addons.length === 0 ? 'Aucun add-on disponible.' : 'Aucun add-on ne correspond à ces filtres.'}
      />
      {!loading && !error && !isEmpty && (
        <div className="flex min-h-0 flex-1">
          <ScrollArea className="w-80 shrink-0 border-r border-border/40">
            <div className="flex flex-col gap-3 p-2">
              {groups.map((group) => (
                <div key={group.pack_key}>
                  <div className="flex items-center gap-2 px-3 py-1 text-xs font-medium text-muted-foreground">
                    <span className="truncate">{group.pack_title}</span>
                    <Badge variant="outline">{group.addons.length}</Badge>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {group.addons.map((addon) => (
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
              ))}
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
                  <pre className="whitespace-pre-wrap break-words text-sm">
                    {selected.prompt_md || 'Aucune instruction disponible pour cet add-on.'}
                  </pre>
                </ScrollArea>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
