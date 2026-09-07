import { useEffect, useMemo, useState } from 'react';

import { Badge, Button, Input, Pill, PillBar, ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';
import MarkdownPreview from '@/modules/code-editor/markdown/MarkdownPreview';
import { appendMikeWorkflowDraft } from '@/piecemaker/mike/ComposerActions';
import { setMikePage } from '@/piecemaker/mike/page';
import { AddonsPanel } from '@/piecemaker/mike/pages/AddonsPanel';
import { MikeAsyncState } from '@/piecemaker/mike/pages/MikeAsyncState';
import { normalizeForSearch } from '@/piecemaker/mike/pages/searchText';
import type { MikeWorkflow } from '@/piecemaker/mike/types';
import { useMikeData } from '@/piecemaker/mike/useMikeData';

type WorkflowsTab = 'all' | 'assistant' | 'tabular' | 'addons';

const WORKFLOWS_TABS: { id: WorkflowsTab; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'tabular', label: 'Tabulaire' },
  { id: 'addons', label: 'Add-ons' },
];

function workflowTypeLabel(type: MikeWorkflow['metadata']['type']): string {
  return type === 'assistant' ? 'Assistant' : 'Tabulaire';
}

export function WorkflowsPage({ projectPath }: { projectPath: string | null }) {
  const { data, error, loading, reload } = useMikeData<MikeWorkflow[]>('/workflows');
  const [tab, setTab] = useState<WorkflowsTab>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const workflows = data ?? [];
  const filtered = useMemo(() => {
    const needle = normalizeForSearch(search.trim());
    return workflows.filter((workflow) => {
      if (tab === 'assistant' || tab === 'tabular') {
        if (workflow.metadata.type !== tab) return false;
      }
      if (!needle) return true;
      const haystack = normalizeForSearch(`${workflow.metadata.title} ${workflow.metadata.description ?? ''}`);
      return haystack.includes(needle);
    });
  }, [workflows, tab, search]);

  useEffect(() => {
    if (selectedId && filtered.some((workflow) => workflow.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);

  const selected = filtered.find((workflow) => workflow.id === selectedId) ?? null;
  const isEmpty = !loading && !error && filtered.length === 0;
  const isAddonsTab = tab === 'addons';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/40 px-4 py-3">
        <PillBar>
          {WORKFLOWS_TABS.map((entry) => (
            <Pill key={entry.id} isActive={tab === entry.id} onClick={() => setTab(entry.id)}>{entry.label}</Pill>
          ))}
        </PillBar>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={isAddonsTab ? 'Rechercher un add-on…' : 'Rechercher un workflow…'}
          className="max-w-xs"
        />
      </div>
      {isAddonsTab ? (
        <AddonsPanel projectPath={projectPath} search={search} />
      ) : (
        <>
          <MikeAsyncState
            loading={loading}
            loadingLabel="Chargement des workflows…"
            error={error}
            onRetry={reload}
            empty={isEmpty}
            emptyLabel={workflows.length === 0 ? 'Aucun workflow disponible.' : 'Aucun workflow ne correspond à ces filtres.'}
          />
          {!loading && !error && !isEmpty && (
            <div className="flex min-h-0 flex-1">
              <ScrollArea className="w-80 shrink-0 border-r border-border/40">
                <ul className="flex flex-col gap-1 p-2">
                  {filtered.map((workflow) => (
                    <li key={workflow.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(workflow.id)}
                        className={cn(
                          'flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent',
                          selectedId === workflow.id && 'bg-accent',
                        )}
                      >
                        <span className="block truncate text-sm font-medium">{workflow.metadata.title}</span>
                        {workflow.metadata.description && (
                          <span className="block truncate text-xs text-muted-foreground">{workflow.metadata.description}</span>
                        )}
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline">{workflowTypeLabel(workflow.metadata.type)}</Badge>
                          {workflow.metadata.practice && <Badge variant="outline">{workflow.metadata.practice}</Badge>}
                          {workflow.metadata.language && <Badge variant="outline">{workflow.metadata.language}</Badge>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
              <div className="flex min-h-0 flex-1 flex-col">
                {selected && (
                  <>
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/40 px-4 py-3">
                      <div>
                        <h2 className="text-base font-semibold">{selected.metadata.title}</h2>
                        {selected.metadata.description && <p className="mt-1 text-sm text-muted-foreground">{selected.metadata.description}</p>}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {selected.metadata.practice && <Badge variant="secondary">{selected.metadata.practice}</Badge>}
                          {selected.metadata.language && <Badge variant="secondary">{selected.metadata.language}</Badge>}
                          {selected.metadata.jurisdictions?.map((jurisdiction) => (
                            <Badge key={jurisdiction} variant="secondary">{jurisdiction}</Badge>
                          ))}
                        </div>
                      </div>
                      {projectPath && selected.metadata.type === 'assistant' && (
                        <Button
                          className="shrink-0"
                          onClick={() => {
                            appendMikeWorkflowDraft(selected);
                            setMikePage(null);
                          }}
                        >
                          Utiliser dans la session
                        </Button>
                      )}
                    </div>
                    <ScrollArea className="min-h-0 flex-1 px-4 py-3">
                      {selected.skill_md ? (
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <MarkdownPreview content={selected.skill_md} />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Aucune instruction disponible pour ce workflow.</p>
                      )}
                    </ScrollArea>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
