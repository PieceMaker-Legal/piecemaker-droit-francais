import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';

const DocxDocumentViewer = lazy(() => import('@/piecemaker/docx/DocxDocumentViewer'));

export function LazyDocxDocumentViewer(props: ComponentProps<typeof DocxDocumentViewer>) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
      <DocxDocumentViewer {...props} />
    </Suspense>
  );
}
