import { useCallback, useEffect, useMemo, useState } from 'react';

import { normalizeForSearch } from '@/piecemaker/mike/pages/searchText';
import type { MikeLibraryDocument, MikeLibraryFolder } from '@/piecemaker/mike/types';
import { useMikeData } from '@/piecemaker/mike/useMikeData';

export type MikeLibraryKind = 'file' | 'template';

export type MikeLibraryFolderStackEntry = { id: string; name: string };

type MikeLibraryResponse = {
  documents: MikeLibraryDocument[];
  folders?: MikeLibraryFolder[];
  documentsHasMore?: boolean;
};

export function useMikeLibraryBrowser(kind: MikeLibraryKind, enabled = true) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [folderStack, setFolderStack] = useState<MikeLibraryFolderStackEntry[]>([]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(normalizeForSearch(search.trim())), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setFolderStack([]);
  }, [kind]);

  const currentFolderId = folderStack.at(-1)?.id ?? null;
  const isSearching = debouncedSearch.length > 0;

  const endpoint = useMemo(() => {
    if (!enabled) return null;
    const base = `/library/${kind}`;
    if (isSearching) return `${base}?${new URLSearchParams({ view: 'search', search: debouncedSearch })}`;
    if (currentFolderId) return `${base}?${new URLSearchParams({ parent_folder_id: currentFolderId })}`;
    return base;
  }, [enabled, kind, isSearching, debouncedSearch, currentFolderId]);

  const { data, error, loading, reload } = useMikeData<MikeLibraryResponse>(endpoint);

  const documents = data?.documents ?? [];
  const folders = isSearching ? [] : data?.folders ?? [];
  const documentsHasMore = data?.documentsHasMore ?? false;
  const isEmpty = !loading && !error && documents.length === 0 && folders.length === 0;

  const enterFolder = useCallback((folder: MikeLibraryFolder) => {
    setFolderStack((stack) => [...stack, { id: folder.id, name: folder.name }]);
  }, []);

  const goToStackIndex = useCallback((index: number) => {
    setFolderStack((stack) => stack.slice(0, index + 1));
  }, []);

  const resetNavigation = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setFolderStack([]);
  }, []);

  return {
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
  };
}
