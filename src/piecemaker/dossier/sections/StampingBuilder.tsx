/**
 * "Tampon du cabinet" card of the Dossier > Tampon et pièces section.
 *
 * The stamp is a single PNG/JPEG shared by the whole cabinet — not per case — so
 * this card is self-contained and does not depend on `useDossierCases()`. It talks
 * directly to `/tampon/load|save|delete` (see `stamping-routes.cjs`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Save, Stamp, Trash2, Upload, Wand2, X } from 'lucide-react';

import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, Input, Pill, PillBar } from '@/shared/ui';

import { pmDelete, pmGet, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';
import {
  DEFAULT_STAMP_CONFIG,
  renderStampDataUrl,
  type StampBorder,
  type StampConfig,
  type StampFont,
  type StampShape,
} from './StampingCanvas';

type TamponFormat = 'png' | 'jpeg';

type TamponLoadResponse = {
  success: true;
  tamponImage: string;
  filename: string;
  format: TamponFormat;
};

type TamponSaveResponse = {
  success: true;
  filename: string;
  format: TamponFormat;
  path: string;
};

const SHAPE_OPTIONS: { id: StampShape; label: string }[] = [
  { id: 'circle', label: 'Cercle' },
  { id: 'oval', label: 'Ovale' },
  { id: 'rounded', label: 'Rectangle arrondi' },
  { id: 'rect', label: 'Rectangle' },
];

const BORDER_OPTIONS: { id: StampBorder; label: string }[] = [
  { id: 'double', label: 'Double' },
  { id: 'single', label: 'Simple' },
];

const FONT_OPTIONS: { id: StampFont; label: string }[] = [
  { id: 'sans', label: 'Sans serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Machine à écrire' },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
}

/** Rendered by StampingSection above the pieces panel. No props: it owns its own load/save/delete lifecycle. */
export default function StampingBuilder() {
  // Stamp currently persisted on the server, as returned by GET /tampon/load. Null once
  // confirmed absent (404) so the empty state can be told apart from "still loading".
  const [savedImage, setSavedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A freshly imported or generated image not yet saved. Kept separate from
  // savedImage so the user can discard it without an extra round trip to the server.
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Builder form fields, only used when generating a stamp from scratch.
  const [config, setConfig] = useState<StampConfig>(DEFAULT_STAMP_CONFIG);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadTampon = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await pmGet<TamponLoadResponse>('/tampon/load');
      setSavedImage(response.tamponImage);
    } catch (cause) {
      if (cause instanceof PieceMakerApiError && cause.status === 404) {
        setSavedImage(null);
      } else {
        setLoadError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTampon();
  }, [loadTampon]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPendingError(null);
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setPendingError('Format non supporté. Utilisez une image PNG ou JPEG.');
      return;
    }
    try {
      setPendingImage(await readFileAsDataUrl(file));
    } catch (cause) {
      setPendingError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleGenerate = () => {
    setPendingError(null);
    try {
      setPendingImage(renderStampDataUrl(config));
    } catch (cause) {
      setPendingError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleDiscardPending = () => {
    setPendingImage(null);
    setPendingError(null);
  };

  const handleSave = async () => {
    if (!pendingImage) return;
    setSaving(true);
    setSaveError(null);
    try {
      await pmPost<TamponSaveResponse>('/tampon/save', { tamponImage: pendingImage });
      setSavedImage(pendingImage);
      setPendingImage(null);
    } catch (cause) {
      setSaveError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await pmDelete<{ success: true }>('/tampon/delete');
      setSavedImage(null);
      setPendingImage(null);
    } catch (cause) {
      setDeleteError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  const displayedImage = pendingImage ?? savedImage;
  const isDirty = pendingImage !== null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-start gap-2.5">
          <Stamp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Tampon du cabinet</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Une seule image pour tout le cabinet, apposée sur chaque pièce tamponnée.
            </p>
          </div>
        </div>
        {!loading && !loadError && (
          <Badge variant={displayedImage ? (isDirty ? 'outline' : 'secondary') : 'outline'}>
            {isDirty ? 'Non enregistré' : displayedImage ? 'Enregistré' : 'Aucun tampon'}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Chargement du tampon…
          </div>
        )}

        {!loading && loadError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {!loading && !loadError && (
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="flex h-40 w-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/30">
                {displayedImage ? (
                  <img src={displayedImage} alt="Aperçu du tampon" className="h-full w-full object-contain p-2" />
                ) : (
                  <span className="px-3 text-center text-xs text-muted-foreground">Aucun tampon configuré</span>
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(event) => void handleFileChange(event)}
                />
                <Button type="button" variant="outline" size="sm" onClick={handleImportClick}>
                  <Upload className="h-3.5 w-3.5" />
                  Importer
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Mention haute
                  <Input
                    value={config.topText}
                    maxLength={40}
                    onChange={(event) => setConfig((current) => ({ ...current, topText: event.target.value }))}
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Mention basse
                  <Input
                    value={config.bottomText}
                    maxLength={40}
                    onChange={(event) => setConfig((current) => ({ ...current, bottomText: event.target.value }))}
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Forme</span>
                <PillBar className="w-full flex-wrap justify-start bg-background">
                  {SHAPE_OPTIONS.map((option) => (
                    <Pill
                      key={option.id}
                      isActive={config.shape === option.id}
                      onClick={() => setConfig((current) => ({ ...current, shape: option.id }))}
                      className="h-7 px-2.5 py-1 text-xs"
                    >
                      {option.label}
                    </Pill>
                  ))}
                </PillBar>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Contour</span>
                  <PillBar className="w-full bg-background">
                    {BORDER_OPTIONS.map((option) => (
                      <Pill
                        key={option.id}
                        isActive={config.border === option.id}
                        onClick={() => setConfig((current) => ({ ...current, border: option.id }))}
                        className="h-7 px-2.5 py-1 text-xs"
                      >
                        {option.label}
                      </Pill>
                    ))}
                  </PillBar>
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Police</span>
                  <PillBar className="w-full bg-background">
                    {FONT_OPTIONS.map((option) => (
                      <Pill
                        key={option.id}
                        isActive={config.font === option.id}
                        onClick={() => setConfig((current) => ({ ...current, font: option.id }))}
                        className="h-7 px-2.5 py-1 text-xs"
                      >
                        {option.label}
                      </Pill>
                    ))}
                  </PillBar>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Couleur
                  <Input
                    type="color"
                    value={config.color}
                    className="h-9 w-full cursor-pointer p-1"
                    onChange={(event) => setConfig((current) => ({ ...current, color: event.target.value }))}
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Épaisseur ({config.lineWidth}px)
                  <Input
                    type="range"
                    min={4}
                    max={20}
                    value={config.lineWidth}
                    className="h-9 cursor-pointer"
                    onChange={(event) => setConfig((current) => ({ ...current, lineWidth: Number(event.target.value) }))}
                  />
                </label>
              </div>

              <Button type="button" variant="secondary" size="sm" onClick={handleGenerate}>
                <Wand2 className="h-3.5 w-3.5" />
                Générer le tampon
              </Button>
            </div>
          </div>
        )}

        {pendingError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{pendingError}</span>
          </div>
        )}
        {saveError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}
        {deleteError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{deleteError}</span>
          </div>
        )}
      </CardContent>

      {!loading && !loadError && (
        <CardFooter className="flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!isDirty || saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Enregistrer le tampon
          </Button>
          {isDirty && (
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={handleDiscardPending}>
              <X className="h-3.5 w-3.5" />
              Annuler
            </Button>
          )}
          {savedImage && !isDirty && (
            <Button type="button" variant="outline" size="sm" disabled={deleting} onClick={() => void handleDelete()}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Supprimer le tampon
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
