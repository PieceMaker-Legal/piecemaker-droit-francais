/**
 * "Tampon et pièces" section of the Dossier tab.
 *
 * Reproduces, in CloudCLI's UI, the standalone admin panel's stamp management and
 * numbered piece stamping (`PieceMaker-Installer/admin/`). Split into two
 * self-contained cards: StampingBuilder (the cabinet-wide stamp, independent of any
 * case) and StampingPieces (per-case piece selection, ordering and stamping, backed
 * by the shared `useDossierCases()` selection from DossierContext).
 */

import { ScrollArea } from '@/shared/ui';

import StampingBuilder from './StampingBuilder';
import StampingPieces from './StampingPieces';

export default function StampingSection() {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <StampingBuilder />
        <StampingPieces />
      </div>
    </ScrollArea>
  );
}
