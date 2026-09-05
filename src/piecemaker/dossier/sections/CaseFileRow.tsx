import { memo } from 'react';
import { BookOpen, FolderOpen, Loader2, ShieldCheck, Unlock } from 'lucide-react';

import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

import type { CaseFileEntry, PieceProtectionState } from '@/piecemaker/dossier/sections/CaseFilesTypes';
import {
  formatBytes,
  formatDateTime,
  originalsStatusLabel,
  PIECE_STATE_HINTS,
  PIECE_STATE_LABELS,
} from '@/piecemaker/dossier/sections/CaseFilesUtils';

const PIECE_STATES: { id: PieceProtectionState; icon: typeof ShieldCheck }[] = [
  { id: 'vault', icon: ShieldCheck },
  { id: 'workspace', icon: Unlock },
  { id: 'resource', icon: BookOpen },
];

type CaseFileRowProps = {
  file: CaseFileEntry;
  state: PieceProtectionState;
  isSelected: boolean;
  isSaving: boolean;
  jobRunning: boolean;
  onToggleSelected: (path: string) => void;
  onSavePieceState: (file: CaseFileEntry, state: PieceProtectionState) => void;
  onRevealPiece: (file: CaseFileEntry) => void;
};

function CaseFileRow({
  file,
  state,
  isSelected,
  isSaving,
  jobRunning,
  onToggleSelected,
  onSavePieceState,
  onRevealPiece,
}: CaseFileRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 hover:bg-accent/30">
      {!file.resource && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelected(file.path)}
          disabled={jobRunning}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{file.name}</span>
          <span className="inline-flex h-5 items-center rounded border border-border/50 px-1 text-[10px] font-bold uppercase text-muted-foreground">
            {file.extension.replace('.', '') || '—'}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{formatBytes(file.size)}</span>
          <span>·</span>
          <span>{formatDateTime(file.modifiedAt)}</span>
          <span>·</span>
          <span>{originalsStatusLabel(file)}</span>
          {file.pipelineEligible === false && (
            <>
              <span>·</span>
              <span>Hors pipeline</span>
            </>
          )}
        </div>
      </div>

      <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border/50">
        {PIECE_STATES.map((entry) => {
          const Icon = entry.icon;
          const isActive = entry.id === state;
          return (
            <button
              key={entry.id}
              type="button"
              title={PIECE_STATE_HINTS[entry.id]}
              disabled={isSaving}
              onClick={() => onSavePieceState(file, entry.id)}
              className={cn(
                'flex h-7 w-7 items-center justify-center transition-colors',
                isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
              aria-pressed={isActive}
              aria-label={PIECE_STATE_LABELS[entry.id]}
            >
              {isSaving && isActive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
            </button>
          );
        })}
      </div>

      <Button
        variant="ghost"
        size="icon"
        title="Afficher dans le gestionnaire de fichiers"
        className="h-7 w-7 shrink-0"
        onClick={() => onRevealPiece(file)}
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default memo(CaseFileRow);
