export { LazyDocxDocumentViewer as DocxDocumentViewer } from '@/piecemaker/docx/LazyDocxDocumentViewer';

export const isDocxDocument = (fileName: string) => fileName.toLowerCase().endsWith('.docx');
