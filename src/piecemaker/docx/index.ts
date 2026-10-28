export { LazyDocxDocumentViewer as DocxDocumentViewer } from '@/piecemaker/docx/LazyDocxDocumentViewer';
export { DocxSaveContext } from '@/piecemaker/docx/pendingSaves';

export const isDocxDocument = (fileName: string) => fileName.toLowerCase().endsWith('.docx');
