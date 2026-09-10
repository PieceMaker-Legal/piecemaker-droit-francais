import { act, useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { api } from '@/shared/api';
import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';
import { startLibraryDocumentViewer } from '@/piecemaker/library/bootstrap';

vi.mock('@/modules/code-editor', async (importOriginal) => ({
  ...await importOriginal<object>(),
  EditorSidebar: ({ editingFile, onCloseEditor }: { editingFile: { projectId: string; path: string }; onCloseEditor: () => void }) => {
    const [content, setContent] = useState('');
    useEffect(() => { void api.readFile(editingFile.projectId, editingFile.path).then((response) => response.json()).then((data) => setContent(data.content)); }, [editingFile.projectId, editingFile.path]);
    return <aside data-path={editingFile.path}><article>{content}</article><button onClick={onCloseEditor}>Fermer</button><button onClick={() => { void api.saveFile(editingFile.projectId, editingFile.path, 'Version modifiée'); }}>Enregistrer</button></aside>;
  },
}));

let stop: (() => void) | undefined;
let container: HTMLDivElement;
const readFile = api.readFile;
const saveFile = api.saveFile;
afterEach(() => { act(() => stop?.()); stop = undefined; container?.remove(); });

it('docks the native editor beside the library and restores file access when closed', async () => {
  container = document.createElement('div');
  document.body.append(container);
  const save = vi.fn(async () => {});
  await act(async () => { stop = startLibraryDocumentViewer(); });
  await act(async () => { window.dispatchEvent(new CustomEvent('piecemaker:library-document', { detail: { name: 'Relire', content: 'Instructions privées', container, save } })); });
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(container.querySelector('aside')?.textContent).toContain('Instructions privées');
  await act(async () => { container.querySelectorAll('button')[1]?.click(); });
  expect(save).toHaveBeenCalledWith('Version modifiée');
  await act(async () => { container.querySelector('button')?.click(); });
  expect(container.querySelector('aside')).toBeNull();
  expect(api.readFile).toBe(readFile);
  expect(api.saveFile).toBe(saveFile);
});

it('keeps a plugin file extension when opening the native editor', async () => {
  container = document.createElement('div');
  document.body.append(container);
  await act(async () => { stop = startLibraryDocumentViewer(); });
  await act(async () => { window.dispatchEvent(new CustomEvent('piecemaker:library-document', { detail: { name: 'Plugin/configuration', editorPath: 'config/settings.json', content: '{}', container, save: async () => {} } })); });
  expect(container.querySelector('aside')?.dataset.path).toBe('config/settings.json');
});

it('clears the document on expiry and plugin unmount', async () => {
  container = document.createElement('div');
  document.body.append(container);
  await act(async () => { stop = startLibraryDocumentViewer(); });
  for (const closeEvent of [AUTH_SESSION_EXPIRED_EVENT, 'piecemaker:library-close']) {
    await act(async () => { window.dispatchEvent(new CustomEvent('piecemaker:library-document', { detail: { name: 'Relire', content: 'Instructions privées', container, save: async () => {} } })); });
    expect(container.querySelector('aside')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event(closeEvent)); });
    expect(container.querySelector('aside')).toBeNull();
    expect(api.readFile).toBe(readFile);
  }
});
