/**
 * Module à effet de bord, sur le modèle de `import '@/modules/i18n'` : il permet
 * à `src/main.tsx` de n'accueillir qu'une seule ligne d'import, sans appel ni
 * variable — le plus petit ajout possible dans un fichier upstream.
 */

import { startIdentityHighlighting } from '@/piecemaker/anonymizer';
import { startCitationPanel } from '@/piecemaker/citations/bootstrap';
import { startAddonsWorkspace } from '@/piecemaker/addons/bootstrap';
import { startLibraryDocumentViewer } from '@/piecemaker/library/bootstrap';

startIdentityHighlighting();
const stopCitationPanel = startCitationPanel();
const stopAddonsWorkspace = startAddonsWorkspace();
const stopLibraryDocumentViewer = startLibraryDocumentViewer();
if (import.meta.hot) import.meta.hot.dispose(() => { stopCitationPanel(); stopAddonsWorkspace(); stopLibraryDocumentViewer(); });
