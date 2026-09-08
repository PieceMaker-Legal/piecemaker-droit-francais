import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { AddonsAsyncState } from '@/piecemaker/addons/pages/AddonsAsyncState';
import { normalizeForSearch } from '@/piecemaker/addons/pages/searchText';
import type { AddonsWorkflow } from '@/piecemaker/addons/types';
import { useAddonsData } from '@/piecemaker/addons/useAddonsData';

type WorkflowPickerDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (workflow: AddonsWorkflow, prompt: string | null) => void;
};

export function WorkflowPickerDialog({ open, onClose, onSelect }: WorkflowPickerDialogProps) {
  const { t } = useTranslation('addons');
  const { data, error, loading, reload } = useAddonsData<AddonsWorkflow[]>(open ? '/workflows' : null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (open) return;
    setSearch('');
    setSelectedId(null);
    setPrompt('');
  }, [open]);

  const assistantWorkflows = useMemo(
    () => (data ?? []).filter((workflow) => workflow.metadata.type === 'assistant'),
    [data],
  );

  const filtered = useMemo(() => {
    const needle = normalizeForSearch(search.trim());
    if (!needle) return assistantWorkflows;
    return assistantWorkflows.filter((workflow) =>
      normalizeForSearch(`${workflow.metadata.title} ${workflow.metadata.description ?? ''}`).includes(needle),
    );
  }, [assistantWorkflows, search]);

  useEffect(() => {
    if (!open) return;
    if (selectedId && filtered.some((workflow) => workflow.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [open, filtered, selectedId]);

  const selected = filtered.find((workflow) => workflow.id === selectedId) ?? null;
  const isEmpty = !loading && !error && filtered.length === 0;

  const confirm = () => {
    if (!selected) return;
    onSelect(selected, prompt.trim() || null);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogTitle>{t('workflowPicker.title')}</DialogTitle>
        <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-3">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('common.searchWorkflowPlaceholder')} className="max-w-xs" autoFocus />
        </div>
        <AddonsAsyncState
          loading={loading}
          loadingLabel={t('common.loadingWorkflows')}
          error={error}
          onRetry={reload}
          empty={isEmpty}
          emptyLabel={t('common.noWorkflows')}
        />
        {!loading && !error && !isEmpty && (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <ul className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/40 p-2">
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
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              {selected && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold">{selected.metadata.title}</h3>
                    {selected.metadata.description && <p className="mt-1 text-sm text-muted-foreground">{selected.metadata.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selected.metadata.practice && <Badge variant="secondary">{selected.metadata.practice}</Badge>}
                      {selected.metadata.language && <Badge variant="secondary">{selected.metadata.language}</Badge>}
                      {selected.metadata.jurisdictions?.map((jurisdiction) => (
                        <Badge key={jurisdiction} variant="secondary">{jurisdiction}</Badge>
                      ))}
                    </div>
                  </div>
                  <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor="addons-workflow-picker-prompt">
                    {t('workflowPicker.promptLabel')}
                    <textarea
                      id="addons-workflow-picker-prompt"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      rows={4}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder={t('workflowPicker.promptPlaceholder')}
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        )}
        <div className="flex shrink-0 justify-end gap-2 border-t border-border/40 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={confirm} disabled={!selected}>{t('workflowPicker.confirm')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
