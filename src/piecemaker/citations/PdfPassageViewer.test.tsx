import { render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { PdfPassageViewer } from '@/piecemaker/citations/PdfPassageViewer';

const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }));
vi.mock('pdfjs-dist', () => pdfjs);
vi.mock('@/shared/api', () => ({ api: { readFileBlob: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) } }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

test('closing a PDF during loading destroys its loading task and worker', async () => {
  const destroy = vi.fn(async () => {});
  pdfjs.getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
  const view = render(<PdfPassageViewer file={{ name: 'exemple.pdf', path: '/exemple.pdf' }} projectId="example" passage={{ quote: 'Texte fictif.', nonce: 1 }} isSidebar onClose={vi.fn()} />);
  await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledOnce());
  view.unmount();
  expect(destroy).toHaveBeenCalledOnce();
});

test('closing a loaded PDF destroys its owning task without calling a removed document API', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const destroy = vi.fn(async () => {});
  const document = { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }), getViewport: () => ({ width: 100, height: 100 }) }) };
  pdfjs.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy });
  const view = render(<PdfPassageViewer file={{ name: 'exemple.pdf', path: '/exemple.pdf' }} projectId="example" passage={{ quote: 'Texte fictif.', nonce: 1 }} isSidebar onClose={vi.fn()} />);
  await waitFor(() => expect(view.queryByText('Chargement…')).toBeNull());
  view.unmount();
  expect(destroy).toHaveBeenCalledOnce();
});
