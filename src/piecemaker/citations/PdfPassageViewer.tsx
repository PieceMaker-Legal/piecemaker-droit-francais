import { useEffect, useRef, useState } from 'react';

import type { CitationPassage } from '@/piecemaker/citations/citationPassage';
import '@/piecemaker/citations/citations.css';
import { locateQuotes } from '@/piecemaker/citations/locateQuote';
import { highlightRectsForQuote, pageTextFromItems, pdfGlyphsFromItems, type HighlightRect } from '@/piecemaker/citations/pdfPassage';
import { api } from '@/shared/api';
import type { CodeEditorFile } from '@/shared/types';

type Pdfjs = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<Pdfjs['getDocument']>['promise']>;

type PdfPassageViewerProps = {
  file: CodeEditorFile;
  projectId?: string;
  passage: CitationPassage;
  isSidebar: boolean;
  onClose: () => void;
};

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return pdfjs;
}

async function findPassagePage(pdf: PdfDocument, quote: string, preferred?: number) {
  const pages = pdf.numPages;
  const order: number[] = [];
  if (preferred && preferred >= 1 && preferred <= pages) order.push(preferred);
  for (let page = 1; page <= pages; page += 1) if (page !== preferred) order.push(page);
  for (const pageNumber of order) {
    const page = await pdf.getPage(pageNumber);
    const { text } = pageTextFromItems(pdfGlyphsFromItems((await page.getTextContent()).items));
    if (locateQuotes(text, quote).length) return pageNumber;
  }
  return preferred && preferred >= 1 && preferred <= pages ? preferred : 1;
}

/** Used by FileDocumentEditor to show a cited PDF page with the quoted passage marked. */
export function PdfPassageViewer({ file, projectId, passage, isSidebar }: PdfPassageViewerProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  // Page count and current page so the cited page can be shown and paged through.
  const [pageCount, setPageCount] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  // Highlight boxes in CSS pixels, aligned with the rendered canvas.
  const [rects, setRects] = useState<HighlightRect[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(projectId));

  useEffect(() => {
    if (!projectId) return undefined;
    const controller = new AbortController();
    let loadingTask: ReturnType<Pdfjs['getDocument']> | undefined;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await api.readFileBlob(projectId, file.path, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        const pdfjs = await loadPdfjs();
        if (controller.signal.aborted) return;
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
        const pdf = await loadingTask.promise;
        if (controller.signal.aborted) return;
        pdfRef.current = pdf;
        const found = await findPassagePage(pdf, passage.quote, passage.page);
        if (controller.signal.aborted) return;
        setPageCount(pdf.numPages);
        setPageNumber(found);
        setLoading(false);
      } catch (loadError: unknown) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'PDF illisible.');
        setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      void loadingTask?.destroy();
      pdfRef.current = null;
    };
  }, [file.path, projectId, passage.quote, passage.page, passage.nonce]);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    const pdf = pdfRef.current;
    if (!frame || !canvas || !pdf || loading) return undefined;
    let cancelled = false;
    const render = async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const width = frame.clientWidth || page.getViewport({ scale: 1 }).width;
      const cssScale = width / page.getViewport({ scale: 1 }).width;
      const dpr = window.devicePixelRatio || 1;
      const cssViewport = page.getViewport({ scale: cssScale });
      const paintViewport = page.getViewport({ scale: cssScale * dpr });
      canvas.width = paintViewport.width;
      canvas.height = paintViewport.height;
      canvas.style.width = `${cssViewport.width}px`;
      canvas.style.height = `${cssViewport.height}px`;
      const context = canvas.getContext('2d');
      if (!context) return;
      await page.render({ canvas, viewport: paintViewport }).promise;
      if (cancelled) return;
      const glyphs = pdfGlyphsFromItems((await page.getTextContent()).items);
      setRects(highlightRectsForQuote(glyphs, passage.quote, { transform: cssViewport.transform, scale: cssViewport.scale }));
    };
    void render().catch(() => {
      if (!cancelled) setRects([]);
    });
    const observer = new ResizeObserver(() => { void render().catch(() => undefined); });
    observer.observe(frame);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [loading, pageNumber, passage.quote, passage.nonce]);

  useEffect(() => {
    const mark = frameRef.current?.querySelector('.piecemaker-pdf-passage-mark');
    mark?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [rects]);

  return (
    <div className={`piecemaker-file-document piecemaker-pdf-passage ${isSidebar ? '' : 'fixed inset-0 z-[9999] bg-background'}`}>
      <header className="piecemaker-file-document-header">
        <span className="truncate" title={file.path}>{file.name}</span>
        {pageCount > 1 && (
          <span className="piecemaker-pdf-passage-pager">
            <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((current) => current - 1)} aria-label="Page précédente">‹</button>
            <span>{pageNumber} / {pageCount}</span>
            <button type="button" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((current) => current + 1)} aria-label="Page suivante">›</button>
          </span>
        )}
      </header>
      {(error || !projectId) && <p role="alert" className="piecemaker-file-document-error">{error ?? 'Dossier indisponible.'}</p>}
      <div ref={frameRef} className="piecemaker-file-document-body piecemaker-pdf-passage-frame">
        {loading ? <p className="piecemaker-pdf-passage-status">Chargement…</p> : (
          <div className="piecemaker-pdf-passage-page">
            <canvas ref={canvasRef} />
            {rects.map((rect, index) => (
              <mark
                key={`${rect.left}-${rect.top}-${index}`}
                className="piecemaker-pdf-passage-mark piecemaker-citation-mark"
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
