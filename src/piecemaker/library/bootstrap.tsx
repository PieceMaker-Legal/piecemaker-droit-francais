import { createRoot } from 'react-dom/client';

import { ThemeProvider } from '@/shared/context/ThemeContext';
import { LibraryDocumentViewer } from '@/piecemaker/library/LibraryDocumentViewer';

export function startLibraryDocumentViewer() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<ThemeProvider><LibraryDocumentViewer /></ThemeProvider>);
  return () => { root.unmount(); host.remove(); };
}
