import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import DocxDocumentViewer from '@/piecemaker/docx/DocxDocumentViewer';
import { api, authenticatedFetch } from '@/shared/api';

vi.mock('@/shared/api', () => ({
  api: { readFileBlob: vi.fn() },
  authenticatedFetch: vi.fn(),
}));

vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: { username: 'Jean Dupont' } }),
}));

vi.mock('@eigenpal/docx-editor-react', async () => {
  const React = await import('react');
  return {
    DocxEditor: React.forwardRef<
      { save: () => Promise<ArrayBuffer> },
      { documentName: string; onChange: () => void; onCommentsChange: (comments: { id: number; parentId?: number }[]) => void; renderLogo: () => React.ReactNode }
    >((props, ref) => {
      React.useImperativeHandle(ref, () => ({ save: async () => new Uint8Array([1, 2, 3]).buffer }));
      return (
        <>
          {props.renderLogo()}
          <button type="button" onClick={props.onChange}>{props.documentName}</button>
          <button type="button" onClick={() => props.onCommentsChange([{ id: 1 }, { id: 2 }, { id: 3, parentId: 1 }])}>emit-comments</button>
        </>
      );
    }),
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.mocked(api.readFileBlob).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
});

afterEach(() => {
  vi.useRealTimers();
});

test('opens and saves a DOCX linked through an encoded Markdown href', async () => {
  const actualPath = '/Users/tsardet/Documents/07 - PieceMaker/REAL TEST/Résumé du dossier et personnes clés.docx';
  const encodedPath = '/Users/tsardet/Documents/07%20-%20PieceMaker/REAL%20TEST/R%C3%A9sum%C3%A9%20du%20dossier%20et%20personnes%20cl%C3%A9s.docx';
  const requestedPaths: string[] = [];

  vi.mocked(authenticatedFetch).mockImplementation(async (url, options) => {
    const filePath = new URL(url, 'http://localhost').searchParams.get('path');
    requestedPaths.push(filePath ?? '');
    if (options?.method === 'PUT') return new Response(JSON.stringify({ version: 2 }), { status: 200 });
    return new Response(JSON.stringify({ version: 1 }), { status: filePath === actualPath ? 200 : 400 });
  });

  render(<DocxDocumentViewer file={{ name: encodedPath.split('/').pop() ?? '', path: encodedPath }} projectId="project-1" isSidebar onClose={() => undefined} />);

  const editor = await screen.findByRole('button', { name: 'Résumé du dossier et personnes clés.docx' });
  assert.deepEqual(requestedPaths, [encodedPath, actualPath]);
  assert.deepEqual(vi.mocked(api.readFileBlob).mock.calls[0], ['project-1', actualPath]);

  vi.useFakeTimers();
  fireEvent.pointerDown(editor);
  fireEvent.click(editor);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });

  assert.equal(vi.mocked(authenticatedFetch).mock.calls.length, 3);
  assert.equal(requestedPaths[2], actualPath);
  assert.equal(vi.mocked(authenticatedFetch).mock.calls[2]?.[1]?.method, 'PUT');
});

test('keeps a literal percent sequence when that file exists', async () => {
  const filePath = '/case/report%20draft.docx';
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));

  render(<DocxDocumentViewer file={{ name: 'report%20draft.docx', path: filePath }} projectId="project-1" isSidebar onClose={() => undefined} />);

  await screen.findByRole('button', { name: 'report%20draft.docx' });
  assert.equal(vi.mocked(authenticatedFetch).mock.calls.length, 1);
  assert.deepEqual(vi.mocked(api.readFileBlob).mock.calls[0], ['project-1', filePath]);
});

test('shows the number of comment threads on the closed comments button', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));

  render(<DocxDocumentViewer file={{ name: 'note.docx', path: '/case/note.docx' }} projectId="project-1" isSidebar onClose={() => undefined} />);

  const commentsButton = await screen.findByRole('button', { name: 'Commentaires' });
  fireEvent.click(screen.getByRole('button', { name: 'emit-comments' }));

  assert.equal(commentsButton.textContent, '2');
  assert.equal(commentsButton.getAttribute('aria-pressed'), 'false');
});
