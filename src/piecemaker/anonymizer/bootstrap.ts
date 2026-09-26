/**
 * Module à effet de bord, sur le modèle de `import '@/modules/i18n'` : il permet
 * à `src/main.tsx` de n'accueillir qu'une seule ligne d'import, sans appel ni
 * variable — le plus petit ajout possible dans un fichier upstream.
 */

import { startIdentityHighlighting } from '@/piecemaker/anonymizer';
import { startPluginsReloadAfterLogin } from '@/piecemaker/auth/reloadPluginsAfterLogin';
import { startDocumentVerificationHighlighting } from '@/piecemaker/anonymizer/documentVerifier';
import { startCitationPanel } from '@/piecemaker/citations/bootstrap';
import { startLibraryDocumentViewer } from '@/piecemaker/library/bootstrap';
import { startShellEnvironmentWarning } from '@/piecemaker/shell-environment/bootstrap';
import '@/piecemaker/sidebar-anonymization/bootstrap';
import '@/piecemaker/theme.css';

startIdentityHighlighting();
const stopDocumentVerificationHighlighting = startDocumentVerificationHighlighting();
const stopCitationPanel = startCitationPanel();
const stopLibraryDocumentViewer = startLibraryDocumentViewer();
const stopPluginsReloadAfterLogin = startPluginsReloadAfterLogin();
const stopShellEnvironmentWarning = startShellEnvironmentWarning();
if (import.meta.hot) import.meta.hot.dispose(() => { stopDocumentVerificationHighlighting(); stopCitationPanel(); stopLibraryDocumentViewer(); stopPluginsReloadAfterLogin(); stopShellEnvironmentWarning(); });
