/** Grouped list pane of the "Skills et agents" section: instructions, agents, PieceMaker skills, and read-only marketplace skills. */

import { useState } from 'react';
import { Bot, Blocks, FileText, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';

import { cn } from '@/shared/utils';
import { Badge, Button, ScrollArea } from '@/shared/ui';

import { pmDelete, PieceMakerApiError } from '../api';
import {
  FILE_GROUP_LABELS,
  type ClaudeAssetState,
  type ManagedFile,
  type ManagedFileKind,
} from './SkillsSection';

const GROUP_ICONS: Record<ManagedFileKind, typeof FileText> = {
  instructions: FileText,
  agent: Bot,
  skill: Sparkles,
  'official-skill': Blocks,
};

const ASSET_STATE_BADGE: Record<ClaudeAssetState, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  linked: { label: 'Lié', variant: 'default' },
  copied: { label: 'Copié', variant: 'default' },
  stale: { label: 'Périmé', variant: 'secondary' },
  conflict: { label: 'Conflit', variant: 'destructive' },
  missing: { label: 'Non enregistré', variant: 'outline' },
};

type SkillsFileListProps = {
  groups: Array<{ kind: ManagedFileKind; files: ManagedFile[] }>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreate: (kind: 'skill' | 'agent') => void;
  onBrowseMarketplace: () => void;
  /** Reloads the file list after a file or an asset has been deleted. */
  onAssetDeleted: (deletedPath: string, wasSelected: boolean) => void;
};

export default function SkillsFileList({
  groups,
  selectedPath,
  onSelect,
  onCreate,
  onBrowseMarketplace,
  onAssetDeleted,
}: SkillsFileListProps) {
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteFile = async (file: ManagedFile) => {
    const label = file.kind === 'official-skill' ? 'ce skill de plugin' : `« ${file.name} »`;
    if (!window.confirm(`Supprimer ${label} ? Cette action est irréversible.`)) return;
    setPendingPath(file.path);
    setDeleteError(null);
    try {
      await pmDelete('/file', undefined, { path: file.path });
      onAssetDeleted(file.path, file.path === selectedPath);
    } catch (cause) {
      setDeleteError(cause instanceof PieceMakerApiError ? cause.message : 'Suppression impossible.');
    } finally {
      setPendingPath(null);
    }
  };

  const deleteAsset = async (assetPath: string) => {
    if (!window.confirm('Supprimer ce fichier annexe ?')) return;
    setPendingPath(assetPath);
    setDeleteError(null);
    try {
      await pmDelete('/asset', undefined, { path: assetPath });
      onAssetDeleted(assetPath, false);
    } catch (cause) {
      setDeleteError(cause instanceof PieceMakerApiError ? cause.message : 'Suppression impossible.');
    } finally {
      setPendingPath(null);
    }
  };

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border/50">
      {deleteError && (
        <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {deleteError}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-2">
          {groups.map((group) => {
            const GroupIcon = GROUP_ICONS[group.kind];
            const canCreate = group.kind === 'skill' || group.kind === 'agent';
            return (
              <section key={group.kind}>
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{FILE_GROUP_LABELS[group.kind]}</span>
                  </div>
                  {canCreate && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label={`Créer un ${group.kind === 'skill' ? 'skill' : 'agent'}`}
                      onClick={() => onCreate(group.kind as 'skill' | 'agent')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {group.kind === 'official-skill' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label="Parcourir la marketplace"
                      onClick={onBrowseMarketplace}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                <div className="space-y-0.5">
                  {group.files.map((file) => {
                    const isSelected = file.path === selectedPath;
                    const stateBadge = file.claudeCode ? ASSET_STATE_BADGE[file.claudeCode.state] : null;
                    return (
                      <div key={file.path}>
                        <div
                          className={cn(
                            'group flex items-center gap-1 rounded-md px-2 py-1.5',
                            isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onSelect(file.path)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                          >
                            <span className="min-w-0 flex-1 truncate">{file.name}</span>
                            {!file.exists && (
                              <Badge variant="outline" className="shrink-0 text-[10px]">Absent</Badge>
                            )}
                            {stateBadge && (
                              <Badge variant={stateBadge.variant} className="shrink-0 text-[10px]">
                                {stateBadge.label}
                              </Badge>
                            )}
                          </button>
                          {(file.kind === 'skill' || file.kind === 'agent' || file.kind === 'official-skill') && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                              aria-label={`Supprimer ${file.name}`}
                              disabled={pendingPath === file.path}
                              onClick={() => void deleteFile(file)}
                            >
                              {pendingPath === file.path
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                        </div>

                        {file.assets && file.assets.length > 0 && (
                          <div className="ml-6 space-y-0.5 border-l border-border/40 pl-2">
                            {file.assets.map((asset) => (
                              <div key={asset.path} className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted/50">
                                <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                                  aria-label={`Supprimer ${asset.name}`}
                                  disabled={pendingPath === asset.path}
                                  onClick={() => void deleteAsset(asset.path)}
                                >
                                  {pendingPath === asset.path
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <Trash2 className="h-3 w-3" />}
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
