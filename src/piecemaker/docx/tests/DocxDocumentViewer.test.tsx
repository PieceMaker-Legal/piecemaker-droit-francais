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

vi.mock('@eigenpal/docx-editor-react', async () => {
  const React = await import('react');
  return {
    DocxEditor: React.forwardRef<{ save: () => Promise<ArrayBuffer> }, { documentName: string; onChange: () => void }>((props, ref) => {
      React.useImperativeHandle(ref, () => ({ save: async () => new Uint8Array([1, 2, 3]).buffer }));
      return <button type="button" onClick={props.onChange}>{props.documentName}</button>;
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
  const actualPath = '~/Documents/exemple/dossier-test.docx';
  const encodedPath = '~/Documents/exemple/dossier-test.docx';
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
