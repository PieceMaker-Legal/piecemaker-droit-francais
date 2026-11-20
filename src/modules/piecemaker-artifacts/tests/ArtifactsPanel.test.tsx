import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ArtifactsPanel } from '@/modules/piecemaker-artifacts';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import type { ArtifactThread } from '@/shared/types';

afterEach(() => vi.unstubAllGlobals());

test('a review opened by the agent saves annotations and decisions to its selected version', { timeout: 10000 }, async () => {
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
  Object.assign(window, { __piecemakerArtifactsShow: { project, artifact: `${id}@v1` } });
  render(<ThemeProvider><ArtifactsPanel project={project} /></ThemeProvider>);

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
