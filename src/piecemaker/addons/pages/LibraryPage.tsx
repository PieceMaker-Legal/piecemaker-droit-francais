import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Input, Pill, PillBar } from '@/shared/ui';
import { downloadAddonsDocument } from '@/piecemaker/addons/api';
import { useAddonsLibraryBrowser, type AddonsLibraryKind } from '@/piecemaker/addons/hooks/useAddonsLibraryBrowser';
import { formatAddonsDocumentDate, formatAddonsDocumentSize } from '@/piecemaker/addons/libraryFormat';
import { AddonsAsyncState } from '@/piecemaker/addons/pages/AddonsAsyncState';
import type { AddonsLibraryDocument } from '@/piecemaker/addons/types';

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function LibraryPage() {
  const { t } = useTranslation('addons');
  const [kind, setKind] = useState<AddonsLibraryKind>('file');
  const [pendingDownloadId, setPendingDownloadId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

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
  } = useAddonsLibraryBrowser(kind);

  useEffect(() => {
    setDownloadError('');
  }, [kind]);

  const handleDownload = async (doc: AddonsLibraryDocument) => {
    setDownloadError('');
    setPendingDownloadId(doc.id);
    try {
      const file = await downloadAddonsDocument(doc.id);
      downloadFile(file);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : t('errors.documentUnavailable'));
    } finally {
      setPendingDownloadId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/40 px-4 py-3">
        <PillBar>
          <Pill isActive={kind === 'file'} onClick={() => setKind('file')}>{t('libraryPage.files')}</Pill>
          <Pill isActive={kind === 'template'} onClick={() => setKind('template')}>{t('libraryPage.templates')}</Pill>
        </PillBar>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('common.searchDocumentPlaceholder')} className="max-w-xs" />
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
          {downloadError && <p role="alert" className="px-2 py-1 text-sm text-destructive">{downloadError}</p>}
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
            <div key={doc.id} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent/50">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">{doc.filename}</span>
                {doc.file_type && <Badge variant="outline">{doc.file_type.toUpperCase()}</Badge>}
                <span className="shrink-0 text-xs text-muted-foreground">{formatAddonsDocumentSize(doc.size_bytes)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatAddonsDocumentDate(doc.created_at)}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pendingDownloadId === doc.id}
                onClick={() => handleDownload(doc)}
              >
                {pendingDownloadId === doc.id ? t('libraryPage.downloading') : t('libraryPage.download')}
              </Button>
            </div>
          ))}
          {documentsHasMore && (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t('common.partialResults')}</p>
          )}
        </div>
      )}
    </div>
  );
}
