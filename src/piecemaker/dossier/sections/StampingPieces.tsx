/**
 * "Pièces à tamponner" card of the Dossier > Tampon et pièces section.
 *
 * Selects, orders and stamps a case's original pieces. The click-to-append order
 * gives the initial bordereau; up/down/remove controls let it be corrected without
 * starting over, which the standalone admin UI (click-only) did not offer.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileText,
  FolderOpen,
  Loader2,
  Stamp,
  X,
  XCircle,
} from 'lucide-react';

import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';

import { pmGet, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { useDossierCases } from '@/piecemaker/dossier/DossierContext';

/** One original piece of the selected case, as returned by GET /repository/case. */
type CaseOriginalPiece = {
  name: string;
  /** Relative to the case root — this is what /stamping expects in `pieces`. */
  path: string;
  extension: string;
  size: number;
  modifiedAt: string;
  converted: boolean;
  scanned: boolean;
  protected: boolean;
  resource: boolean;
  status: 'ready' | 'awaiting-scan' | 'not-converted';
};

type CaseDetailResponse = {
  folder: {
    originals: CaseOriginalPiece[];
  };
};

type StampingPieceResult = {
  pieceNumber: number;
  id: string;
  filename: string;
  success: boolean;
  error?: string;
  outputFileName?: string;
};

type StampingResponse = {
  success: true;
  folder: string;
  tamponnedDir: string;
  results: StampingPieceResult[];
  summary: { total: number; success: number; failure: number };
  message: string;
};

type RevealResponse = { ok: true; target: string; path: string };

const STATUS_LABEL: Record<CaseOriginalPiece['status'], string> = {
  ready: 'Prête',
  'awaiting-scan': 'Non scannée',
  'not-converted': 'Non convertie',
};

/** Rendered by StampingSection below StampingBuilder. No props: the case comes from useDossierCases(). */
export default function StampingPieces() {
  const { cases, selectedCaseId, selectedCase, selectCase, loading: casesLoading, error: casesError } = useDossierCases();

  const [originals, setOriginals] = useState<CaseOriginalPiece[] | null>(null);
  const [originalsLoading, setOriginalsLoading] = useState(false);
  const [originalsError, setOriginalsError] = useState<string | null>(null);

  // Bordereau order: piece paths in the sequence that becomes "Pièce n°1, n°2…".
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<StampingResponse | null>(null);

  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const loadOriginals = useCallback(async (caseId: string) => {
    setOriginalsLoading(true);
    setOriginalsError(null);
    try {
      const response = await pmGet<CaseDetailResponse>('/repository/case', { case: caseId });
      setOriginals(response.folder.originals ?? []);
    } catch (cause) {
      setOriginals(null);
      setOriginalsError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setOriginalsLoading(false);
    }
  }, []);

  // Switching case invalidates the previous bordereau and any past run result.
  useEffect(() => {
    setSelectedOrder([]);
    setRunResult(null);
    setRunError(null);
    setRevealError(null);
    if (selectedCaseId) {
      void loadOriginals(selectedCaseId);
    } else {
      setOriginals(null);
    }
  }, [selectedCaseId, loadOriginals]);

  const togglePiece = (path: string) => {
    setSelectedOrder((current) =>
      current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path],
    );
  };

  const movePiece = (index: number, direction: -1 | 1) => {
    setSelectedOrder((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removePiece = (path: string) => setSelectedOrder((current) => current.filter((entry) => entry !== path));

  const handleRun = async () => {
    if (!selectedCase || selectedOrder.length === 0) return;
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const response = await pmPost<StampingResponse>('/stamping', {
        pieces: selectedOrder,
        documentId: selectedCase.path,
        folder: selectedCase.location,
      });
      setRunResult(response);
    } catch (cause) {
      setRunError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const handleReveal = async () => {
    if (!selectedCase) return;
    setRevealing(true);
    setRevealError(null);
    try {
      await pmPost<RevealResponse>('/reveal', { target: 'files', case: selectedCase.path, path: 'Pièces tamponnées' });
    } catch (cause) {
      setRevealError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setRevealing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2.5">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <CardTitle className="text-base">Pièces à tamponner</CardTitle>
        </div>
        {cases.length > 0 && (
          <select
            value={selectedCaseId ?? ''}
            onChange={(event) => selectCase(event.target.value || null)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {cases.map((entry) => (
              <option key={entry.path} value={entry.path}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {casesLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Chargement des dossiers…
          </div>
        )}

        {!casesLoading && casesError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{casesError}</span>
          </div>
        )}

        {!casesLoading && !casesError && cases.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucun dossier enregistré. Enregistrez-en un depuis la section « Dossiers ».
          </p>
        )}

        {!casesLoading && !casesError && cases.length > 0 && !selectedCase && (
          <p className="text-sm text-muted-foreground">Sélectionnez un dossier ci-dessus.</p>
        )}

        {selectedCase && (
          <>
            {originalsLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Chargement des pièces…
              </div>
            )}

            {!originalsLoading && originalsError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{originalsError}</span>
              </div>
            )}

            {!originalsLoading && !originalsError && originals && originals.length === 0 && (
              <p className="text-sm text-muted-foreground">Ce dossier ne contient aucune pièce originale.</p>
            )}

            {!originalsLoading && !originalsError && originals && originals.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Pièces du dossier — cliquer pour ajouter au bordereau
                  </p>
                  <ScrollArea className="h-64 rounded-md border border-border/60">
                    <div className="space-y-1 p-1.5">
                      {originals.map((piece) => {
                        const orderIndex = selectedOrder.indexOf(piece.path);
                        const isSelected = orderIndex !== -1;
                        return (
                          <button
                            key={piece.path}
                            type="button"
                            onClick={() => togglePiece(piece.path)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors',
                              isSelected
                                ? 'border-primary/40 bg-primary/5'
                                : 'border-transparent hover:bg-muted/50',
                            )}
                          >
                            {isSelected ? (
                              <Badge className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full p-0 text-[11px]">
                                {orderIndex + 1}
                              </Badge>
                            ) : (
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="flex-1 truncate">{piece.path}</span>
                            {piece.status !== 'ready' && (
                              <Badge variant="outline" className="shrink-0 text-[10px]">
                                {STATUS_LABEL[piece.status]}
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Bordereau ({selectedOrder.length} pièce{selectedOrder.length > 1 ? 's' : ''})
                  </p>
                  <ScrollArea className="h-64 rounded-md border border-border/60">
                    <div className="space-y-1 p-1.5">
                      {selectedOrder.length === 0 && (
                        <p className="p-2 text-sm text-muted-foreground">Aucune pièce sélectionnée.</p>
                      )}
                      {selectedOrder.map((path, index) => {
                        const piece = originals.find((entry) => entry.path === path);
                        return (
                          <div
                            key={path}
                            className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm"
                          >
                            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                              Pièce n°{index + 1}
                            </span>
                            <span className="flex-1 truncate">{piece?.name ?? path}</span>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={index === 0}
                                onClick={() => movePiece(index, -1)}
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={index === selectedOrder.length - 1}
                                onClick={() => movePiece(index, 1)}
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => removePiece(path)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}

            {runError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{runError}</span>
              </div>
            )}

            {runResult && (
              <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{runResult.message}</p>
                  <Button type="button" variant="outline" size="sm" disabled={revealing} onClick={() => void handleReveal()}>
                    {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                    Ouvrir « Pièces tamponnées »
                  </Button>
                </div>
                {revealError && <p className="text-xs text-destructive">{revealError}</p>}
                <ul className="space-y-1">
                  {runResult.results.map((result) => (
                    <li key={`${result.pieceNumber}-${result.id}`} className="flex items-start gap-2 text-sm">
                      {result.success ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                      )}
                      <span className="flex-1">
                        Pièce n°{result.pieceNumber} — {result.filename}
                        {!result.success && result.error && (
                          <span className="block text-xs text-red-600 dark:text-red-400">{result.error}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>

      {selectedCase && originals && originals.length > 0 && (
        <CardFooter>
          <Button type="button" disabled={selectedOrder.length === 0 || running} onClick={() => void handleRun()}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stamp className="h-3.5 w-3.5" />}
            {running
              ? 'Tamponnage en cours…'
              : `Tamponner ${selectedOrder.length || ''} pièce${selectedOrder.length > 1 ? 's' : ''}`.trim()}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
