import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { acceptChangeById, rejectChangeById } from '@eigenpal/docx-editor-core/prosemirror/commands';
import { extractTrackedChanges } from '@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges';

import DocxDocumentViewer from '@/piecemaker/docx/DocxDocumentViewer';
import { api, authenticatedFetch } from '@/shared/api';
import { checkDocxDocumentReasoning } from '@/modules/docx-reasoning/api';

vi.mock('@/shared/api', () => ({
  api: { readFileBlob: vi.fn() },
  authenticatedFetch: vi.fn(),
}));

vi.mock('@/modules/docx-reasoning/api', () => ({ checkDocxDocumentReasoning: vi.fn() }));

vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: { username: 'Jean Dupont' } }),
}));

vi.mock('@eigenpal/docx-editor-core/prosemirror/commands', () => ({
  acceptChange: vi.fn(() => () => false),
  rejectChange: vi.fn(() => () => false),
  acceptChangeById: vi.fn(() => () => true),
  rejectChangeById: vi.fn(() => () => true),
}));

vi.mock('@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges', () => ({
  extractTrackedChanges: vi.fn(() => ({
    entries: [{ type: 'insertion', text: 'ajout', author: 'Jean', revisionId: 7, from: 1, to: 6 }],
    commentToRevision: new Map(),
  })),
}));

vi.mock('@eigenpal/docx-editor-react', async () => {
  const React = await import('react');
  const emptyMarks = { marks: () => [], nodeAfter: null, nodeBefore: null };
  const view = {
    state: { selection: { $from: emptyMarks }, storedMarks: null },
    dispatch: vi.fn(),
  };
  return {
    DocxEditor: React.forwardRef<
      { save: () => Promise<ArrayBuffer>; getZoom: () => number; getComments: () => []; getEditorRef: () => unknown },
      {
        documentName: string;
        onChange: () => void;
        onCommentsChange: (comments: { id: number; parentId?: number }[]) => void;
        onCommentsSidebarOpenChange?: (open: boolean) => void;
        renderLogo: () => React.ReactNode;
      }
    >((props, ref) => {
      React.useImperativeHandle(ref, () => ({
        save: async () => new Uint8Array([1, 2, 3]).buffer,
        getZoom: () => 1,
        getComments: () => [],
        getEditorRef: () => ({
          getView: () => view,
          getHfPmViews: () => new Map(),
          relayout: vi.fn(),
        }),
      }));
      return (
        <>
          {props.renderLogo()}
          <button type="button" onClick={props.onChange}>{props.documentName}</button>
          <button type="button" onClick={() => props.onCommentsChange([{ id: 1 }, { id: 2 }, { id: 3, parentId: 1 }])}>emit-comments</button>
          <span
            className="docx-insertion"
            data-revision-id="7"
            data-pm-start="1"
            data-pm-end="6"
            onClick={() => props.onCommentsSidebarOpenChange?.(true)}
          >
            ajout
          </span>
          <div className="docx-tracked-change-card">
            <button type="button" title="Accepter">valider</button>
            <button type="button" title="Refuser">croix</button>
            <span>"ajout"</span>
          </div>
        </>
      );
    }),
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.mocked(checkDocxDocumentReasoning).mockResolvedValue({ version: 1, reasoning: { status: 'unlinked' } });
  vi.mocked(api.readFileBlob).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  vi.mocked(acceptChangeById).mockImplementation(() => () => true);
  vi.mocked(rejectChangeById).mockImplementation(() => () => true);
  vi.mocked(extractTrackedChanges).mockReturnValue({
    entries: [{ type: 'insertion', text: 'ajout', author: 'Jean', revisionId: 7, from: 1, to: 6 }],
    commentToRevision: new Map(),
  });
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

test('keeps loading while the document is still being written', async () => {
  vi.useFakeTimers();
  let exists = false;
  vi.mocked(authenticatedFetch).mockImplementation(async () => (
    exists
      ? new Response(JSON.stringify({ version: 1 }), { status: 200 })
      : new Response(JSON.stringify({ error: 'File not found' }), { status: 404 })
  ));
  vi.mocked(api.readFileBlob).mockImplementation(async () => (
    exists
      ? new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      : new Response('', { status: 404 })
  ));

  render(<DocxDocumentViewer file={{ name: 'bonjour.docx', path: 'bonjour.docx' }} projectId="project-1" isSidebar onClose={() => undefined} />);
  await act(async () => { await Promise.resolve(); });
  assert.equal(screen.getByText('Chargement…').textContent, 'Chargement…');
  assert.equal(screen.queryByText(/HTTP 404/), null);

  exists = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  assert.equal(screen.getByRole('button', { name: 'bonjour.docx' }).textContent, 'bonjour.docx');
});

test('keeps a literal percent sequence when that file exists', async () => {
  const filePath = '/case/report%20draft.docx';
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));

  render(<DocxDocumentViewer file={{ name: 'report%20draft.docx', path: filePath }} projectId="project-1" isSidebar onClose={() => undefined} />);

  await screen.findByRole('button', { name: 'report%20draft.docx' });
  assert.equal(vi.mocked(authenticatedFetch).mock.calls.length, 1);
  assert.deepEqual(vi.mocked(api.readFileBlob).mock.calls[0], ['project-1', filePath]);
});

test('tracked insertions are Word blue without highlight; deletions are red strikethrough', () => {
  const css = readFileSync('src/piecemaker/docx/docxDocumentViewer.css', 'utf8');
  assert.match(css, /--docx-revision-ins:\s*#0000ff/);
  assert.match(css, /--docx-revision-del:\s*#ff0000/);
  assert.match(css, /\.docx-insertion[\s\S]*color:\s*var\(--docx-revision-ins\)/);
  assert.match(css, /\.docx-insertion[\s\S]*background-color:\s*transparent/);
  assert.match(css, /\.docx-insertion[\s\S]*text-decoration:\s*underline/);
  assert.match(css, /\.docx-deletion[\s\S]*color:\s*var\(--docx-revision-del\)/);
  assert.match(css, /\.docx-deletion[\s\S]*background-color:\s*transparent/);
  assert.match(css, /\.docx-deletion[\s\S]*text-decoration:\s*line-through/);
  assert.match(css, /\.docx-unified-sidebar[\s\S]*z-index:\s*80/);
  assert.match(css, /\.docx-tracked-change-card button[\s\S]*pointer-events:\s*auto/);
});

test('shows the number of comment threads on the closed comments button', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));

  render(<DocxDocumentViewer file={{ name: 'note.docx', path: '/case/note.docx' }} projectId="project-1" isSidebar onClose={() => undefined} />);

  const commentsButton = await screen.findByRole('button', { name: 'Commentaires' });
  fireEvent.click(screen.getByRole('button', { name: 'emit-comments' }));

  assert.equal(commentsButton.textContent, '2');
  assert.equal(commentsButton.getAttribute('aria-pressed'), 'false');
});

test('a plain click on a tracked change does not open comments; modifier click does', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  render(<DocxDocumentViewer file={{ name: 'note.docx', path: '/case/note.docx' }} projectId="project-1" isSidebar onClose={() => undefined} />);

  const commentsButton = await screen.findByRole('button', { name: 'Commentaires' });
  const revision = screen.getByText('ajout');

  fireEvent.pointerDown(revision);
  fireEvent.mouseDown(revision);
  fireEvent.click(revision);
  assert.equal(commentsButton.getAttribute('aria-pressed'), 'false');

  const modifier = isMac ? { metaKey: true } : { ctrlKey: true };
  fireEvent.pointerDown(revision, modifier);
  fireEvent.mouseDown(revision, modifier);
  fireEvent.click(revision);
  assert.equal(commentsButton.getAttribute('aria-pressed'), 'true');
});

test('hovering a tracked change shows the comment-open shortcut', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  render(<DocxDocumentViewer file={{ name: 'note.docx', path: '/case/note.docx' }} projectId="project-1" isSidebar onClose={() => undefined} />);

  const revision = await screen.findByText('ajout');
  fireEvent.pointerOver(revision, { clientX: 40, clientY: 80 });

  const hint = screen.getByRole('tooltip');
  assert.match(hint.textContent ?? '', isMac ? /⌘-clic pour ouvrir le commentaire/ : /Ctrl-clic pour ouvrir le commentaire/);

  fireEvent.pointerOut(revision, { relatedTarget: document.body });
  assert.equal(screen.queryByRole('tooltip'), null);
});

test('accepting a tracked change applies the revision and saves', async () => {
  vi.mocked(authenticatedFetch).mockImplementation(async (_url, options) => (
    options?.method === 'PUT'
      ? new Response(JSON.stringify({ version: 2 }), { status: 200 })
      : new Response(JSON.stringify({ version: 1 }), { status: 200 })
  ));

  render(<DocxDocumentViewer file={{ name: 'note.docx', path: '/case/note.docx' }} projectId="project-1" isSidebar onClose={() => undefined} />);
  await screen.findByRole('button', { name: 'note.docx' });

  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'valider' }));

  const acceptedIds = vi.mocked(acceptChangeById).mock.calls.map(([id]) => id);
  assert.ok(acceptedIds.includes(7));
  assert.equal(vi.mocked(extractTrackedChanges).mock.calls.length > 0, true);

  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  const put = vi.mocked(authenticatedFetch).mock.calls.find(([, options]) => options?.method === 'PUT');
  assert.equal(put?.[1]?.method, 'PUT');
});

test('rejecting a tracked change applies the revision', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));

  render(<DocxDocumentViewer file={{ name: 'note.docx', path: '/case/note.docx' }} projectId="project-1" isSidebar onClose={() => undefined} />);
  await screen.findByRole('button', { name: 'note.docx' });

  fireEvent.click(screen.getByRole('button', { name: 'croix' }));

  const rejectedIds = vi.mocked(rejectChangeById).mock.calls.map(([id]) => id);
  assert.ok(rejectedIds.includes(7));
});

test('un DOCX lié est contrôlé à l’ouverture puis après sa sauvegarde automatique', async () => {
  vi.mocked(checkDocxDocumentReasoning).mockResolvedValue({ version: 1, reasoning: { status: 'tested', issues: [] } });
  vi.mocked(authenticatedFetch).mockImplementation(async (_url, options) => new Response(JSON.stringify(options?.method === 'PUT'
    ? { version: 2, reasoning: { status: 'review', changed: ['pm:clause-fictive'], context: [{ tag: 'pm:clause-fictive', text: 'Nouvelle clause fictive.' }] } }
    : { version: 1 }), { status: 200 }));
  render(<DocxDocumentViewer file={{ name: 'contrat-fictif.docx', path: 'contrat-fictif.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  const editor = await screen.findByRole('button', { name: 'contrat-fictif.docx' });
  await screen.findByText('Test local exécuté');
  assert.deepEqual(vi.mocked(checkDocxDocumentReasoning).mock.calls[0], ['projet-fictif', 'contrat-fictif.docx']);
  vi.useFakeTimers();
  fireEvent.pointerDown(editor);
  fireEvent.click(editor);
  assert.match(screen.getByRole('status').textContent ?? '', /vérification à actualiser/);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  assert.equal(screen.getByRole('status').textContent, 'Raisonnement à revoir');
  assert.equal(screen.getByText('Nouvelle clause fictive.').textContent, 'Nouvelle clause fictive.');
  assert.equal(vi.mocked(authenticatedFetch).mock.calls.filter(([, options]) => options?.method === 'PUT').length, 1);
  assert.equal(vi.mocked(checkDocxDocumentReasoning).mock.calls.length, 1);
});

test('une modification externe rechargée déclenche aussi un nouveau contrôle', async () => {
  let version = 1;
  vi.mocked(checkDocxDocumentReasoning).mockImplementation(async () => ({ version, reasoning: { status: 'tested', issues: [] } }));
  vi.mocked(authenticatedFetch).mockImplementation(async () => new Response(JSON.stringify({ version }), { status: 200 }));
  vi.mocked(api.readFileBlob).mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  vi.useFakeTimers();
  render(<DocxDocumentViewer file={{ name: 'contrat-fictif.docx', path: 'contrat-fictif.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  assert.equal(screen.getByRole('status').textContent, 'Test local exécuté');
  version = 2;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(vi.mocked(api.readFileBlob).mock.calls.length, 2);
  assert.equal(vi.mocked(checkDocxDocumentReasoning).mock.calls.length, 2);
  assert.equal(screen.getByRole('status').textContent, 'Test local exécuté');
});

test('une erreur de contrôle ne transforme pas une sauvegarde réussie en erreur d’écriture', async () => {
  vi.mocked(checkDocxDocumentReasoning).mockResolvedValue({ version: 1, reasoning: { status: 'tested', issues: [] } });
  vi.mocked(authenticatedFetch).mockImplementation(async (_url, options) => new Response(JSON.stringify(options?.method === 'PUT'
    ? { version: 2, reasoning: { status: 'error', message: 'Liaison fictive manquante.' } }
    : { version: 1 }), { status: 200 }));
  render(<DocxDocumentViewer file={{ name: 'contrat-fictif.docx', path: 'contrat-fictif.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  const editor = await screen.findByRole('button', { name: 'contrat-fictif.docx' });
  await screen.findByText('Test local exécuté');
  vi.useFakeTimers();
  fireEvent.pointerDown(editor);
  fireEvent.click(editor);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  assert.equal(screen.getByRole('status').textContent, 'Vérification impossible');
  assert.equal(screen.queryByText(/HTTP 500/), null);
});

test('une lecture tardive de l’ancien document est ignorée après le changement de fichier', async () => {
  let resolveOldBlob!: (response: Response) => void;
  let markOldReadStarted!: () => void;
  let markNewReadStarted!: () => void;
  const oldBlob = new Promise<Response>((resolve) => { resolveOldBlob = resolve; });
  const oldReadStarted = new Promise<void>((resolve) => { markOldReadStarted = resolve; });
  const newReadStarted = new Promise<void>((resolve) => { markNewReadStarted = resolve; });
  vi.mocked(authenticatedFetch).mockImplementation(async () => new Response(JSON.stringify({ version: 1 }), { status: 200 }));
  vi.mocked(api.readFileBlob).mockImplementation(async (_projectId, filePath) => {
    if (filePath === 'ancien.docx') {
      markOldReadStarted();
      return oldBlob;
    }
    markNewReadStarted();
    return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
  });
  vi.mocked(checkDocxDocumentReasoning).mockImplementation(async (_projectId, filePath) => ({
    version: 1,
    reasoning: { status: 'tested', issues: [{ kind: 'manque', text: filePath }] },
  }));

  const view = render(<DocxDocumentViewer file={{ name: 'ancien.docx', path: 'ancien.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  await oldReadStarted;
  view.rerender(<DocxDocumentViewer file={{ name: 'nouveau.docx', path: 'nouveau.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  await newReadStarted;
  resolveOldBlob(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  await act(async () => { await oldBlob; await newReadStarted; await Promise.resolve(); });

  await screen.findByRole('button', { name: 'nouveau.docx' });
  assert.deepEqual(vi.mocked(checkDocxDocumentReasoning).mock.calls, [['projet-fictif', 'nouveau.docx']]);
  assert.equal(screen.queryByRole('button', { name: 'ancien.docx' }), null);
  assert.equal(screen.queryByText('ancien.docx'), null);
});

test('une lecture DOCX lente ne lance pas de chargements concurrents à chaque cycle du poll', async () => {
  let version = 1;
  let resolveBlob!: (response: Response) => void;
  const pendingBlob = new Promise<Response>((resolve) => { resolveBlob = resolve; });
  vi.mocked(authenticatedFetch).mockImplementation(async () => new Response(JSON.stringify({ version }), { status: 200 }));
  vi.mocked(api.readFileBlob).mockImplementation(async () => pendingBlob);
  vi.mocked(checkDocxDocumentReasoning).mockResolvedValue({ version: 1, reasoning: { status: 'tested', issues: [] } });
  vi.useFakeTimers();

  render(<DocxDocumentViewer file={{ name: 'lent.docx', path: 'lent.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  assert.equal(vi.mocked(api.readFileBlob).mock.calls.length, 1);
  version = 2;
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

  assert.equal(vi.mocked(api.readFileBlob).mock.calls.length, 1);
  assert.equal(vi.mocked(checkDocxDocumentReasoning).mock.calls.length, 0);
  resolveBlob(new Response(new Uint8Array([7, 8, 9]), { status: 200 }));
  await act(async () => { await pendingBlob; await Promise.resolve(); });
  assert.equal(vi.mocked(checkDocxDocumentReasoning).mock.calls.length, 1);
});

test('les sauvegardes automatiques sont sérialisées et le dernier contrôle reste affiché', async () => {
  let resolveFirstPut!: (response: Response) => void;
  const firstPut = new Promise<Response>((resolve) => { resolveFirstPut = resolve; });
  vi.mocked(authenticatedFetch).mockImplementation(async (_url, options) => {
    if (options?.method === 'PUT') {
      const putCount = vi.mocked(authenticatedFetch).mock.calls.filter(([, request]) => request?.method === 'PUT').length;
      if (putCount === 1) return firstPut;
      return new Response(JSON.stringify({
        version: 3,
        reasoning: { status: 'review', changed: ['pm:clause-fictive'], context: [{ tag: 'pm:clause-fictive', text: 'Dernière retouche fictive.' }] },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ version: 1 }), { status: 200 });
  });
  vi.useFakeTimers();
  render(<DocxDocumentViewer file={{ name: 'contrat-fictif.docx', path: 'contrat-fictif.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const editor = screen.getByRole('button', { name: 'contrat-fictif.docx' });

  fireEvent.pointerDown(editor);
  fireEvent.click(editor);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  assert.equal(vi.mocked(authenticatedFetch).mock.calls.filter(([, options]) => options?.method === 'PUT').length, 1);

  fireEvent.pointerDown(editor);
  fireEvent.click(editor);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  assert.equal(vi.mocked(authenticatedFetch).mock.calls.filter(([, options]) => options?.method === 'PUT').length, 1);

  resolveFirstPut(new Response(JSON.stringify({ version: 2, reasoning: { status: 'tested', issues: [] } }), { status: 200 }));
  await act(async () => {
    await firstPut;
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(vi.mocked(authenticatedFetch).mock.calls.filter(([, options]) => options?.method === 'PUT').length, 2);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(screen.getByRole('status').textContent, 'Raisonnement à revoir');
  assert.equal(screen.getByText('Dernière retouche fictive.').textContent, 'Dernière retouche fictive.');
});


test('un changement du modèle relance le contrôle sans recharger le DOCX', async () => {
  let reasoningVersion = 'modele-initial';
  vi.mocked(authenticatedFetch).mockImplementation(async () => new Response(JSON.stringify({ version: 1, reasoningVersion }), { status: 200 }));
  vi.mocked(checkDocxDocumentReasoning).mockImplementation(async () => ({
    version: 1, reasoning: reasoningVersion === 'modele-initial'
      ? { status: 'tested', issues: [] }
      : { status: 'error', message: 'Modèle externe modifié.' },
  }));
  vi.useFakeTimers();
  render(<DocxDocumentViewer file={{ name: 'scenario-externe.docx', path: 'scenario-externe.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  assert.equal(screen.getByRole('status').textContent, 'Test local exécuté');
  reasoningVersion = 'modele-modifie';
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  assert.equal(screen.getByRole('status').textContent, 'Vérification impossible');
  assert.equal(screen.getByText('Modèle externe modifié.').textContent, 'Modèle externe modifié.');
  assert.equal(vi.mocked(api.readFileBlob).mock.calls.length, 1);
  assert.equal(vi.mocked(checkDocxDocumentReasoning).mock.calls.length, 2);
});

test('un changement du modèle pendant une retouche conserve sa sauvegarde programmée', async () => {
  let reasoningVersion = 'modele-initial';
  vi.mocked(authenticatedFetch).mockImplementation(async (_url, options) => new Response(JSON.stringify({
    version: options?.method === 'PUT' ? 2 : 1, reasoningVersion,
    reasoning: { status: 'error', message: 'Modèle externe modifié.' },
  }), { status: 200 }));
  vi.mocked(checkDocxDocumentReasoning).mockResolvedValue({ version: 1, reasoning: { status: 'tested', issues: [] } });
  vi.useFakeTimers();
  render(<DocxDocumentViewer file={{ name: 'scenario-externe.docx', path: 'scenario-externe.docx' }} projectId="projet-fictif" isSidebar onClose={() => undefined} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  const editor = screen.getByRole('button', { name: 'scenario-externe.docx' });
  fireEvent.pointerDown(editor);
  fireEvent.click(editor);
  reasoningVersion = 'modele-modifie';
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  assert.match(screen.getByRole('status').textContent ?? '', /vérification à actualiser/);
  assert.equal(vi.mocked(checkDocxDocumentReasoning).mock.calls.length, 1);
  assert.equal(vi.mocked(api.readFileBlob).mock.calls.length, 1);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  assert.equal(vi.mocked(authenticatedFetch).mock.calls.filter(([, options]) => options?.method === 'PUT').length, 1);
  assert.equal(screen.getByRole('status').textContent, 'Vérification impossible');
});
