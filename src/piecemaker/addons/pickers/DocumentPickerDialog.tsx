import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import { useAddonsLibraryBrowser } from '@/piecemaker/addons/hooks/useAddonsLibraryBrowser';
import { formatAddonsDocumentSize } from '@/piecemaker/addons/libraryFormat';
import { AddonsAsyncState } from '@/piecemaker/addons/pages/AddonsAsyncState';

type DocumentPickerDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (documentIds: string[]) => void;
};

export function DocumentPickerDialog({ open, onClose, onConfirm }: DocumentPickerDialogProps) {
  const { t } = useTranslation('addons');
  const {
    search,
    setSearch,
    folderStack,
    isSearching,
    documents,
    folders,
    documentsHasMore,
    isEmpty,
    loading,
    error,
    reload,
    enterFolder,
    goToStackIndex,
    resetNavigation,
  } = useAddonsLibraryBrowser('file', open);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    resetNavigation();
  }, [open, resetNavigation]);

  const toggleDocument = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = () => {
    if (selectedIds.size === 0) return;
    onConfirm(Array.from(selectedIds));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogTitle>{t('documentPicker.title')}</DialogTitle>
        <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-3">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('common.searchDocumentPlaceholder')} className="max-w-xs" autoFocus />
        </div>
        {!isSearching && (
          <nav aria-label={t('common.libraryBreadcrumb')} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-4 py-2 text-sm">
            <button type="button" onClick={() => goToStackIndex(-1)} className="text-muted-foreground hover:text-foreground">{t('common.library')}</button>
            {folderStack.map((entry, index) => (
              <span key={entry.id} className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                <button type="button" onClick={() => goToStackIndex(index)} className="text-muted-foreground hover:text-foreground">{entry.name}</button>
              </span>
            ))}
          </nav>
        )}
        <AddonsAsyncState
          loading={loading}
          loadingLabel={t('common.loadingLibrary')}
          error={error}
          onRetry={reload}
          empty={isEmpty}
          emptyLabel={isSearching ? t('common.noSearchResults') : t('common.noDocumentsInFolder')}
        />
        {!loading && !error && !isEmpty && (
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => enterFolder(folder)}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="truncate font-medium">{folder.name}</span>
                <span className="text-muted-foreground">{t('common.open')}</span>
              </button>
            ))}
            {documents.map((doc) => (
              <label key={doc.id} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent/50">
                <input type="checkbox" checked={selectedIds.has(doc.id)} onChange={() => toggleDocument(doc.id)} />
                <span className="min-w-0 flex-1 truncate font-medium">{doc.filename}</span>
                {doc.file_type && <Badge variant="outline">{doc.file_type.toUpperCase()}</Badge>}
                <span className="shrink-0 text-xs text-muted-foreground">{formatAddonsDocumentSize(doc.size_bytes)}</span>
              </label>
            ))}
            {documentsHasMore && (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t('common.partialResults')}</p>
            )}
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {t('documentPicker.selectedCount', { count: selectedIds.size, plural: selectedIds.size > 1 ? 's' : '' })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={confirm} disabled={selectedIds.size === 0}>{t('common.confirm')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
