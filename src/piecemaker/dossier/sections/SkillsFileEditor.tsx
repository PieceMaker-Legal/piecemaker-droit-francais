/**
 * Editor pane of the "Skills et agents" section: raw Markdown content of the
 * selected instructions file, agent, or skill (front matter included), plus
 * asset upload for skills.
 *
 * The legacy admin panel split front matter into dedicated form fields and
 * rendered a WYSIWYG view over the body. That machinery
 * (`splitMarkdownDocument`/`visualEditorToMarkdown`/`markdownToHtml`) isn't
 * reproduced here: the backend already derives everything it needs (name,
 * description, rename-on-save) by parsing the front matter out of whatever
 * Markdown text is saved, so a single CodeMirror surface over the full file
 * keeps every feature without the extra editor machinery.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { Loader2, Paperclip, Save, TriangleAlert } from 'lucide-react';

import { useTheme } from '@/shared/context/ThemeContext';
import { authenticatedFetch } from '@/shared/api';
import { Badge, Button } from '@/shared/ui';

import { pmGet, pmPut, PieceMakerApiError } from '../api';
import type { ManagedFile, ManagedFileContent } from './SkillsSection';

const EDITOR_EXTENSIONS = [markdown()];

type PutFileResponse = {
  ok: true;
  path: string;
  backup: string | null;
  savedAt: string;
  renamedFrom?: string;
};

type SkillsFileEditorProps = {
  file: ManagedFile | null;
  onDirtyChange: (dirty: boolean) => void;
  /** Save succeeded — `path` is the (possibly renamed) path to reselect. */
  onSaved: (path: string) => void;
  onAssetsUploaded: () => void;
};

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof PieceMakerApiError) return cause.message;
  return cause instanceof Error ? cause.message : fallback;
}

export default function SkillsFileEditor({ file, onDirtyChange, onSaved, onAssetsUploaded }: SkillsFileEditorProps) {
  const { isDarkMode } = useTheme();
  const [content, setContent] = useState<ManagedFileContent | null>(null);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setContent(null);
      setDraft('');
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaveNotice(null);
    setAssetError(null);

    pmGet<ManagedFileContent>('/file', { path: file.path })
      .then((response) => {
        if (cancelled) return;
        setContent(response);
        setDraft(response.content);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(cause, 'Impossible de charger ce fichier.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  const isDirty = content !== null && draft !== content.content;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    setSaveNotice(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!file || !content) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const response = await pmPut<PutFileResponse>('/file', { path: file.path, content: draft });
      setSaveNotice(response.renamedFrom ? 'Renommé et enregistré.' : 'Enregistré.');
      onSaved(response.path);
    } catch (cause) {
      setSaveError(errorMessage(cause, 'Enregistrement impossible.'));
    } finally {
      setIsSaving(false);
    }
  }, [content, draft, file, onSaved]);

  const handleAssetUpload = useCallback(async (uploadedFile: File) => {
    if (!file) return;
    setIsUploadingAsset(true);
    setAssetError(null);
    try {
      const buffer = await uploadedFile.arrayBuffer();
      const response = await authenticatedFetch('/api/piecemaker/asset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Skill-Path': file.path,
          'X-Filename': encodeURIComponent(uploadedFile.name),
        },
        body: buffer,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new PieceMakerApiError(payload?.error || `Erreur ${response.status}`, response.status);
      }
      onAssetsUploaded();
    } catch (cause) {
      setAssetError(errorMessage(cause, 'Envoi du fichier annexe impossible.'));
    } finally {
      setIsUploadingAsset(false);
    }
  }, [file, onAssetsUploaded]);

  if (!file) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Sélectionnez un fichier à gauche pour l’ouvrir.
      </div>
    );
  }

  const isReadOnly = file.readonly || content?.readonly === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
          <span className="truncate text-xs text-muted-foreground">{file.path}</span>
          {!file.exists && <Badge variant="outline" className="shrink-0 text-[10px]">Sera créé à l’enregistrement</Badge>}
          {isReadOnly && <Badge variant="secondary" className="shrink-0 text-[10px]">Lecture seule</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {file.kind === 'skill' && file.exists && !isReadOnly && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0];
                  event.target.value = '';
                  if (picked) void handleAssetUpload(picked);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAsset}
              >
                {isUploadingAsset ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                Ajouter une annexe
              </Button>
            </>
          )}
          {!isReadOnly && (
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={isSaving || !isDirty}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </Button>
          )}
        </div>
      </div>

      {(loadError || saveError || assetError) && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError || saveError || assetError}</span>
        </div>
      )}
      {saveNotice && !saveError && (
        <div className="mx-4 mt-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground">
          {saveNotice}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading || !content ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : (
          <CodeMirror
            value={draft}
            onChange={handleChange}
            extensions={EDITOR_EXTENSIONS}
            theme={isDarkMode ? oneDark : undefined}
            editable={!isReadOnly}
            height="100%"
            style={{ height: '100%', fontSize: '13px' }}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              dropCursor: false,
              allowMultipleSelections: false,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              highlightSelectionMatches: true,
              searchKeymap: true,
            }}
          />
        )}
      </div>
    </div>
  );
}
