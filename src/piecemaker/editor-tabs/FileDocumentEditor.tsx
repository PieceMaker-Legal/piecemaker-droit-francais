import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { EditorView } from '@codemirror/view';
import { CodeXml } from 'lucide-react';

import CodeEditor from '@/modules/code-editor/CodeEditor';
import CodeEditorSurface from '@/modules/code-editor/CodeEditorSurface';
import { useCodeEditorDocument } from '@/modules/code-editor/hooks/useCodeEditorDocument';
import { useCodeEditorSettings } from '@/modules/code-editor/hooks/useCodeEditorSettings';
import MarkdownPreview from '@/modules/code-editor/markdown/MarkdownPreview';
import { isBinaryFile } from '@/modules/code-editor/utils/binaryFile';
import { getLanguageExtensions } from '@/modules/code-editor/utils/editorExtensions';
import { getPreviewKind } from '@/modules/code-editor/utils/previewableFile';
import { isDocxDocument } from '@/piecemaker/docx';
import { useTheme } from '@/shared/context/ThemeContext';
import type { CodeEditorFile } from '@/shared/types';

const AUTOSAVE_DELAY_MS = 1000;

const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name);

function TextDocument({ file, projectPath }: { file: CodeEditorFile; projectPath?: string }) {
  const { isDarkMode } = useTheme();
  const { showLineNumbers, fontSize } = useCodeEditorSettings();
  const { content, setContent, loading, saveError, handleSave } = useCodeEditorDocument({ file, projectPath });
  const markdown = isMarkdown(file.name);
  const [source, setSource] = useState(!markdown);
  const [dirty, setDirty] = useState(false);
  const save = useRef(handleSave);
  const pending = useRef(false);

  useEffect(() => { save.current = handleSave; });
  useEffect(() => { pending.current = dirty; }, [dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const timer = setTimeout(() => { setDirty(false); void save.current(); }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, dirty]);

  useEffect(() => () => { if (pending.current) void save.current(); }, []);

  useEffect(() => {
    const saveNow = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      setDirty(false);
      void save.current();
    };
    document.addEventListener('keydown', saveNow);
    return () => document.removeEventListener('keydown', saveNow);
  }, []);

  const extensions = useMemo(() => [...getLanguageExtensions(file.name), EditorView.lineWrapping], [file.name]);

  if (loading) return null;

  return (
    <div className="piecemaker-file-document">
      <header className="piecemaker-file-document-header">
        <span className="truncate" title={file.path}>{file.name}</span>
        {markdown && (
          <button
            type="button"
            aria-pressed={source}
            aria-label={source ? 'Afficher le rendu' : 'Modifier la source'}
            title={source ? 'Afficher le rendu' : 'Modifier la source'}
            onClick={() => setSource((current) => !current)}
          >
            <CodeXml />
          </button>
        )}
      </header>
      {saveError && <p role="alert" className="piecemaker-file-document-error">Enregistrement impossible : {saveError}</p>}
      <div className="piecemaker-file-document-body">
        {source ? (
          <CodeEditorSurface
            content={content}
            onChange={(value) => { setContent(value); setDirty(true); }}
            markdownPreview={false}
            isMarkdownFile={markdown}
            isDarkMode={isDarkMode}
            fontSize={fontSize}
            showLineNumbers={showLineNumbers}
            extensions={extensions}
          />
        ) : (
          <div className="piecemaker-file-document-preview prose max-w-none dark:prose-invert">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  );
}

export function FileDocumentEditor(props: ComponentProps<typeof CodeEditor>) {
  const { file } = props;
  if (file.diffInfo || getPreviewKind(file.name) || isDocxDocument(file.name) || isBinaryFile(file.name)) return <CodeEditor {...props} />;
  return <TextDocument file={file} projectPath={props.projectPath} />;
}
