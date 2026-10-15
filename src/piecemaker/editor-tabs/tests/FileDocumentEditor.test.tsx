import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCitationPassage, setCitationPassage } from '@/piecemaker/citations/citationPassage';
import { FileDocumentEditor } from '@/piecemaker/editor-tabs/FileDocumentEditor';
import type { CodeEditorFile } from '@/shared/types';

const SAMPLE = '# Titre Gaston\n\nBonjour, Gaston !';

vi.mock('@/modules/code-editor/hooks/useCodeEditorDocument', () => ({
  useCodeEditorDocument: () => ({
    content: SAMPLE,
    setContent: vi.fn(),
    loading: false,
    saveError: null,
    handleSave: vi.fn(),
  }),
}));

vi.mock('@/modules/code-editor/hooks/useCodeEditorSettings', () => ({
  useCodeEditorSettings: () => ({ showLineNumbers: true, fontSize: 14 }),
}));

vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock('@/modules/code-editor/CodeEditor', () => ({
  default: ({ file }: { file: { name: string } }) => <div data-testid="delegated-editor">{file.name}</div>,
}));

vi.mock('@/modules/code-editor/CodeEditorSurface', () => ({
  default: ({ content }: { content: string }) => <pre data-testid="file-source">{content}</pre>,
}));

vi.mock('@/piecemaker/citations/PdfPassageViewer', () => ({
  PdfPassageViewer: ({ file }: { file: { name: string } }) => <div data-testid="pdf-passage">{file.name}</div>,
}));

const file = (name: string, extras: Partial<CodeEditorFile> = {}): CodeEditorFile => ({
  name,
  path: name,
  projectId: 'dossier-exemple',
  ...extras,
});

const open = (name: string, extras: Partial<CodeEditorFile> = {}) =>
  render(<FileDocumentEditor file={file(name, extras)} onClose={() => undefined} isSidebar />);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

describe('visionneuse classique : source par défaut', () => {
  it('un Markdown s’ouvre sur la source, pas le rendu', () => {
    open('SKILL.md');
    expect(screen.getByTestId('file-source').textContent).toBe(SAMPLE);
    expect(screen.queryByRole('heading', { name: 'Titre Gaston' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Afficher le rendu' })).toBeTruthy();
  });

  it('le bouton Markdown bascule vers le rendu puis revient à la source', () => {
    open('notes.md');
    fireEvent.click(screen.getByRole('button', { name: 'Afficher le rendu' }));
    expect(screen.getByRole('heading', { name: 'Titre Gaston' })).toBeTruthy();
    expect(screen.queryByTestId('file-source')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier la source' }));
    expect(screen.getByTestId('file-source').textContent).toBe(SAMPLE);
    expect(screen.queryByRole('heading', { name: 'Titre Gaston' })).toBeNull();
  });

  it('un .txt s’ouvre sur la source, sans bouton de rendu', () => {
    open('notes.txt');
    expect(screen.getByTestId('file-source').textContent).toBe(SAMPLE);
    expect(screen.queryByRole('button', { name: 'Afficher le rendu' })).toBeNull();
    expect(screen.queryByTestId('delegated-editor')).toBeNull();
  });

  it('un .ts s’ouvre sur la source', () => {
    open('main.ts');
    expect(screen.getByTestId('file-source').textContent).toBe(SAMPLE);
    expect(screen.queryByTestId('delegated-editor')).toBeNull();
  });

  it('un .json s’ouvre sur la source', () => {
    open('package.json');
    expect(screen.getByTestId('file-source').textContent).toBe(SAMPLE);
  });

  it('un .docx passe à la visionneuse Word', () => {
    open('bonjour.docx');
    expect(screen.getByTestId('delegated-editor').textContent).toBe('bonjour.docx');
    expect(screen.queryByTestId('file-source')).toBeNull();
  });

  it('un .pdf passe à l’aperçu CodeEditor', () => {
    open('piece.pdf');
    expect(screen.getByTestId('delegated-editor').textContent).toBe('piece.pdf');
    expect(screen.queryByTestId('file-source')).toBeNull();
  });

  it('une image passe à l’aperçu CodeEditor', () => {
    open('scan.png');
    expect(screen.getByTestId('delegated-editor').textContent).toBe('scan.png');
  });

  it('un diff passe à CodeEditor', () => {
    open('notes.md', { diffInfo: { old_string: 'a', new_string: 'b' } });
    expect(screen.getByTestId('delegated-editor').textContent).toBe('notes.md');
    expect(screen.queryByTestId('file-source')).toBeNull();
  });
});

describe('citation dans l’original', () => {
  afterEach(() => clearCitationPassage());

  it('un PDF cité s’ouvre avec le passage surligné', () => {
    setCitationPassage('piece.pdf', 'Bonjour, Gaston !', 1);
    open('piece.pdf');
    expect(screen.getByTestId('pdf-passage').textContent).toBe('piece.pdf');
    expect(screen.queryByTestId('delegated-editor')).toBeNull();
  });

  it('un PDF sans citation reste sur l’aperçu CodeEditor', () => {
    open('piece.pdf');
    expect(screen.getByTestId('delegated-editor').textContent).toBe('piece.pdf');
    expect(screen.queryByTestId('pdf-passage')).toBeNull();
  });

  it('un Markdown cité reste sur la source', () => {
    setCitationPassage('SKILL.md', 'Bonjour, Gaston !');
    open('SKILL.md');
    expect(screen.getByTestId('file-source').textContent).toBe(SAMPLE);
  });
});
