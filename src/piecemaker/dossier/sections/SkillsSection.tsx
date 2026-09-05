/**
 * "Skills et agents" section of the Dossier tab: PieceMaker's own skills,
 * agents and instruction files, their registration with Claude Code, and the
 * Claude Code plugin marketplace — all served by the handlers in
 * `server/piecemaker/vendor/websocket-server/admin-routes.cjs` and mounted at
 * `/api/piecemaker` (see `server/piecemaker/router.cjs`).
 *
 * Deliberately out of scope here: PieceMaker hooks, LiteLLM, Ollama,
 * Telegram, git/history and the anonymisation mapping editor — none of them
 * are reachable from the endpoints this section calls.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';

import { Button } from '@/shared/ui';

import { pmGet, PieceMakerApiError } from '../api';
import SkillsFileList from './SkillsFileList';
import SkillsFileEditor from './SkillsFileEditor';
import SkillsCreateDialog from './SkillsCreateDialog';
import SkillsComponentsDialog from './SkillsComponentsDialog';
import SkillsMarketplaceDialog from './SkillsMarketplaceDialog';
import SkillsActivation from './SkillsActivation';

/** One entry of `GET /files` — an instructions file, an agent, a PieceMaker skill, or a read-only marketplace skill. */
export type ManagedFileKind = 'instructions' | 'agent' | 'skill' | 'official-skill';

export type ClaudeAssetState = 'linked' | 'copied' | 'stale' | 'conflict' | 'missing';

export type ClaudeAssetStatus = {
  kind: string;
  slug: string;
  target: string;
  state: ClaudeAssetState;
  origin?: string;
  note?: string;
  adopted?: boolean;
} | null;

export type SkillAsset = {
  name: string;
  path: string;
};

export type ManagedFile = {
  path: string;
  name: string;
  kind: ManagedFileKind;
  exists: boolean;
  readonly: boolean;
  claudeCode: ClaudeAssetStatus;
  assets?: SkillAsset[];
  /** `official-skill` only. */
  plugin?: string;
  marketplace?: string;
  description?: string;
};

/** `GET /file` (or the response embedded in `PUT /file` / `POST /files`). */
export type ManagedFileContent = {
  path: string;
  kind: ManagedFileKind;
  exists: boolean;
  content: string;
  readonly: boolean;
  sourceType?: string;
};

/** One row of `GET /plugin/components` — a repo skill/agent and its Claude Code registration state. */
export type PluginComponent = {
  path: string;
  kind: string;
  slug: string;
  name: string;
  description: string;
  state: ClaudeAssetState;
  registered: boolean;
  note?: string;
};

export type MarketplaceScope = 'legal' | 'official';

/** One row of `GET /plugin/marketplace` — an installable/installed connector. */
export type MarketplacePlugin = {
  id: string;
  name: string;
  description: string;
  marketplace: string;
  installCount: number | null;
  installed: boolean;
  enabled: boolean;
};

export type RegisteredMarketplace = {
  name: string;
  repo: string | null;
  source: string | null;
  official: boolean;
};

const FILE_GROUP_ORDER: ManagedFileKind[] = ['instructions', 'agent', 'skill', 'official-skill'];

export const FILE_GROUP_LABELS: Record<ManagedFileKind, string> = {
  instructions: 'Instructions',
  agent: 'Collabs IA (agents)',
  skill: 'Compétences (skills PieceMaker)',
  'official-skill': 'Compétences (skills marketplace Claude)',
};

/** Groups files the way the legacy admin panel did, dropping empty groups. */
export function groupManagedFiles(files: ManagedFile[]): Array<{ kind: ManagedFileKind; files: ManagedFile[] }> {
  return FILE_GROUP_ORDER
    .map((kind) => ({ kind, files: files.filter((file) => file.kind === kind) }))
    .filter((group) => group.files.length > 0);
}

type FilesResponse = { files: ManagedFile[] };

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof PieceMakerApiError) return cause.message;
  return cause instanceof Error ? cause.message : fallback;
}

type SectionView = 'files' | 'activation';

export default function SkillsSection() {
  const [view, setView] = useState<SectionView>('files');
  const [files, setFiles] = useState<ManagedFile[]>([]);
  // Distinguishes "never loaded" from "loaded, zero files" so the initial spinner shows once.
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Tracks unsaved editor changes so switching files or reloading the list can ask for confirmation first.
  const [isDirty, setIsDirty] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDialogKind, setCreateDialogKind] = useState<'skill' | 'agent'>('skill');
  const [isComponentsDialogOpen, setIsComponentsDialogOpen] = useState(false);
  const [isMarketplaceDialogOpen, setIsMarketplaceDialogOpen] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await pmGet<FilesResponse>('/files');
      setFiles(response.files);
    } catch (cause) {
      setLoadError(errorMessage(cause, 'Impossible de charger les fichiers.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const visibleFiles = useMemo(() => files.filter((file) => file.name !== 'CLAUDE.md'), [files]);
  const groups = useMemo(() => groupManagedFiles(visibleFiles), [visibleFiles]);
  const selectedFile = useMemo(
    () => visibleFiles.find((file) => file.path === selectedPath) ?? null,
    [visibleFiles, selectedPath],
  );

  const requestSelect = useCallback((path: string | null) => {
    if (path === selectedPath) return;
    if (isDirty) {
      const confirmed = window.confirm(
        'Ce fichier contient des modifications non enregistrées. Les abandonner et changer de fichier ?',
      );
      if (!confirmed) return;
    }
    setIsDirty(false);
    setSelectedPath(path);
  }, [isDirty, selectedPath]);

  const handleRefresh = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(
        'Ce fichier contient des modifications non enregistrées. Les abandonner et actualiser la liste ?',
      );
      if (!confirmed) return;
      setIsDirty(false);
    }
    setIsLoading(true);
    void loadFiles();
  }, [isDirty, loadFiles]);

  const handleOpenCreateDialog = useCallback((kind: 'skill' | 'agent') => {
    setCreateDialogKind(kind);
    setIsCreateDialogOpen(true);
  }, []);

  const handleCreated = useCallback((path: string) => {
    setIsCreateDialogOpen(false);
    setIsDirty(false);
    setSelectedPath(path);
    void loadFiles();
  }, [loadFiles]);

  const handleFileMutated = useCallback((nextSelectedPath: string | null) => {
    setIsDirty(false);
    setSelectedPath(nextSelectedPath);
    void loadFiles();
  }, [loadFiles]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-foreground">Skills et agents</h2>
            <p className="truncate text-xs text-muted-foreground">
              Fichiers d’instructions, skills, agents et plugins Claude Code
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView('files')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                view === 'files' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Fichiers
            </button>
            <button
              type="button"
              onClick={() => setView('activation')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                view === 'activation' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Activation par dossier
            </button>
          </div>
          {view === 'files' && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsComponentsDialogOpen(true)}>
                Enregistrement Claude Code
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsMarketplaceDialogOpen(true)}>
                Marketplace de plugins
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleRefresh} disabled={isLoading}>
                <RefreshCw className={isLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                Actualiser
              </Button>
            </>
          )}
        </div>
      </div>

      {view === 'activation' ? (
        <SkillsActivation />
      ) : (
        <>
          {loadError && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          )}

          {isLoading && files.length === 0 ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement des skills et agents…
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <SkillsFileList
                groups={groups}
                selectedPath={selectedPath}
                onSelect={requestSelect}
                onCreate={handleOpenCreateDialog}
                onBrowseMarketplace={() => setIsMarketplaceDialogOpen(true)}
                onAssetDeleted={(_deletedPath, wasSelected) => {
                  if (wasSelected) handleFileMutated(null);
                  else void loadFiles();
                }}
              />
              <SkillsFileEditor
                key={selectedPath ?? 'empty'}
                file={selectedFile}
                onDirtyChange={setIsDirty}
                onSaved={handleFileMutated}
                onAssetsUploaded={() => void loadFiles()}
              />
            </div>
          )}
        </>
      )}

      <SkillsCreateDialog
        open={isCreateDialogOpen}
        kind={createDialogKind}
        onOpenChange={setIsCreateDialogOpen}
        onCreated={handleCreated}
      />
      <SkillsComponentsDialog
        open={isComponentsDialogOpen}
        onOpenChange={setIsComponentsDialogOpen}
        onApplied={() => void loadFiles()}
      />
      <SkillsMarketplaceDialog
        open={isMarketplaceDialogOpen}
        onOpenChange={setIsMarketplaceDialogOpen}
      />
    </div>
  );
}
