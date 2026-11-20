import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { SessionArtifacts } from '@/modules/piecemaker-artifacts';
import { ProjectArtifact } from '@/modules/piecemaker-artifacts/ArtifactsPanel';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import type { ArtifactThread } from '@/shared/types';

import { mount, unmount } from '@/../plugins/piecemaker-artifacts/src/index';

afterEach(() => vi.unstubAllGlobals());

test('a review opened from Project saves annotations and decisions to its selected version', { timeout: 10000 }, async () => {
  const project = '/dossiers/exemple';
  const id = 'contrat-exemple';
  const title = 'Revue du contrat';
  const quote = 'Durée de trois ans';
  const threads: ArtifactThread[] = [];
  const request = vi.fn(async (input: string, options?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('/frame')) return Response.json({ src: '/frame-exemple' });
    if (url.pathname.endsWith('/comments') || url.pathname.endsWith('/reviews')) {
      if (options?.method !== 'POST') return Response.json(threads);
      const { anchor, decision, text, version } = JSON.parse(String(options.body));
      const thread = {
        id: `thread-${threads.length}`,
        anchor: anchor ?? { version, decision },
        resolved: false,
        messages: [{ author: 'lawyer', text, at: '2026-01-01' }],
      };
      threads.push(thread);
      return Response.json(thread, { status: 201 });
    }
    return Response.json({
      id, title, version: 2, url: `piecemaker://artifact/${id}`, data_stamp: 0,
      versions: [{ version: 2, published_at: '2026-01-02' }, { version: 1, published_at: '2026-01-01' }],
    });
  });
  vi.stubGlobal('fetch', request);
  render(<ThemeProvider>
    <ProjectArtifact project={project} projectId="projet-fictif" id={id} onClose={() => undefined} onDirty={() => undefined} />
  </ThemeProvider>);
  fireEvent.change(await screen.findByRole('combobox', { name: 'Version' }), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Revue' }));

  const frame = await waitFor(() => {
    const element = screen.getAllByTitle(title).find((item): item is HTMLIFrameElement => item instanceof HTMLIFrameElement);
    if (!element?.contentWindow) throw new Error('La page de l’artifact est en cours de chargement.');
    return element;
  });
  const review = screen.getByRole('complementary', { name: 'Revue de la version 1' });
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Version' }).value).toBe('1');
  const message = (source: Window | null, op: string, args?: object) => fireEvent(window, new MessageEvent('message', {
    source, data: { channel: 'piecemaker-artifact', op, args },
  }));
  message(window, 'selection', { quote: 'Autre fenêtre', start: 0, before: '', after: '' });
  expect(within(review).queryByText('Autre fenêtre')).toBeNull();

  message(frame.contentWindow, 'ready');
  message(frame.contentWindow, 'selection', { quote, start: 0, before: '', after: '' });
  const annotation = await within(review).findByLabelText('Annotation du passage');
  fireEvent.change(annotation, { target: { value: 'Préciser le point de départ.' } });
  fireEvent.click(within(review).getByRole('button', { name: 'Ajouter l’annotation' }));
  await within(review).findByText('Préciser le point de départ.');
  expect(threads[0].anchor).toEqual({ version: 1, passage: { quote, start: 0, before: '', after: '' } });

  const changes = within(review).getByRole<HTMLButtonElement>('button', { name: 'Demander des modifications' });
  expect(changes.disabled).toBe(true);
  fireEvent.change(within(review).getByLabelText('Remarques sur la décision'), { target: { value: 'Corriger le délai.' } });
  fireEvent.click(changes);
  await within(review).findByText('Modifications demandées');
  expect(threads[1].anchor).toEqual({ version: 1, decision: 'changes_requested' });

  fireEvent.click(screen.getByRole('button', { name: 'Dernière version' }));
  await waitFor(() => expect(screen.getByRole('complementary', { name: 'Revue de la version 2' })).toBeTruthy());
  await screen.findByText('Aucun commentaire sur cette version.');
  expect(screen.queryByText(quote)).toBeNull();
});

test('the original gallery opens HTML and Word artifacts from the thread', async () => {
  const project = '/dossiers/projet-fictif';
  const id = 'note-fictive';
  const title = 'Note fictive';
  const wordId = 'rapport-fictif';
  const documentPath = `${project}/rapport.docx`;
  const artifact = { id, title, url: `piecemaker://artifact/${id}`, version: 2, updated_at: '2026-01-02' };
  const word = { ...artifact, id: wordId, title: 'Rapport Word', format: 'docx', document_path: documentPath };
  const versions = [{ version: 2, published_at: '2026-01-02' }, { version: 1, published_at: '2026-01-01' }];
  const request = vi.fn(async (input: string, options?: RequestInit) => {
    const { pathname, searchParams } = new URL(input, 'http://localhost');
    if (pathname.endsWith('/session/fil-fictif') || pathname.endsWith('/artifacts')) return Response.json([artifact, word]);
    if (pathname.endsWith(`/artifacts/${id}`)) return Response.json({ ...artifact, versions });
    if (pathname.endsWith(`/artifacts/${wordId}`)) return Response.json(word);
    if (pathname.endsWith('/frame')) return Response.json({ src: `/apercu-fictif/${searchParams.get('ver') ?? 2}` });
    if (pathname.endsWith('/comments')) {
      if (options?.method === 'POST') return Response.json({}, { status: 201 });
      return Response.json([]);
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', request);

  const openFileInEditor = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  mount(container, {
    context: { theme: 'light', project: { name: 'projet-fictif', path: project } },
    onContextChange: () => () => undefined,
    openFileInEditor,
  });

  try {
    const tab = within(container);
    await tab.findByRole('heading', { name: title });
    expect(tab.getByRole('tab', { name: 'Tous' }).getAttribute('aria-selected')).toBe('true');
    render(<SessionArtifacts project={project} sessionId="fil-fictif" subscribe={() => () => undefined} />);
    const threadArtifacts = within(await screen.findByRole('group', { name: 'Artifacts de la session' }));
    fireEvent.click(threadArtifacts.getByRole('button', { name: title }));
    const frame = await tab.findByTitle(title, { selector: 'iframe' });
    await waitFor(() => expect(frame.getAttribute('src')).toBe('/apercu-fictif/2'));
    expect(tab.queryByRole('button', { name: 'Annoter' })).toBeNull();
    expect(tab.getByRole('button', { name: 'Lien' })).toBeTruthy();

    Object.assign(window, { __piecemakerArtifactsShow: { project, artifact: `${id}@v1` } });
    window.dispatchEvent(new Event('piecemaker:artifacts-show'));
    const comment = await tab.findByRole('textbox', { name: 'Commentaire' });
    await waitFor(() => expect(frame.getAttribute('src')).toBe('/apercu-fictif/1'));
    fireEvent.change(comment, { target: { value: 'Préciser la date.' } });
    fireEvent.click(tab.getByRole('button', { name: 'Envoyer' }));
    await waitFor(() => {
      const post = request.mock.calls.find(([url, options]) => url.includes('/comments?') && options?.method === 'POST');
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ text: 'Préciser la date.', anchor: { version: 1 } });
    });

    fireEvent.click(tab.getByRole('button', { name: 'Retour à la galerie' }));
    await tab.findByRole('tab', { name: 'Épinglés' });
    fireEvent.click(threadArtifacts.getByRole('button', { name: 'Rapport Word' }));
    await waitFor(() => expect(openFileInEditor).toHaveBeenCalledWith(documentPath));
  } finally {
    unmount(container);
    container.remove();
  }
});
