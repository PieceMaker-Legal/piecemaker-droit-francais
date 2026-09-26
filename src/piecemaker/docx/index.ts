export { default as DocxDocumentViewer } from '@/piecemaker/docx/DocxDocumentViewer';

export const isDocxDocument = (fileName: string) => fileName.toLowerCase().endsWith('.docx');
