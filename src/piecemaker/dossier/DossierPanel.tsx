/**
 * The Dossier workspace tab: PieceMaker's case-file administration, rebuilt with
 * CloudCLI's UI primitives.
 *
 * It replaces the standalone `admin/` page of PieceMaker-Installer and talks to the
 * same handlers, now mounted on the CloudCLI server under `/api/piecemaker`
 * (see `server/piecemaker/router.cjs`).
 *
 * The copy is French throughout, like the panel it comes from: it drives French-law
 * procedure and its vocabulary — bordereau, pièce, tampon — has no settled
 * equivalent in the other locales. Only the tab label is translated
 * (`src/piecemaker/i18n/additions.ts`).
 */

import { useState } from 'react';
import { FolderTree, Stamp, CalendarClock, type LucideIcon } from 'lucide-react';

import { PillBar, Pill, Tooltip } from '@/shared/ui';
import type { Project } from '@/shared/types';
import { DossierCasesProvider, useDossierCases } from '@/piecemaker/dossier/DossierContext';
import CaseFilesSection from '@/piecemaker/dossier/sections/CaseFilesSection';
import StampingSection from '@/piecemaker/dossier/sections/StampingSection';
import CaseFilesChronology from '@/piecemaker/dossier/sections/CaseFilesChronology';
import CaseMappingSetup from '@/piecemaker/dossier/sections/CaseMappingSetup';

type SectionId = 'dossiers' | 'tampon' | 'chronologie';

const SECTIONS: { id: SectionId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'dossiers',      label: 'Général',         hint: 'Pièces, mapping et parties',                      icon: FolderTree },
  { id: 'tampon',        label: 'Tampon et pièces', hint: 'Tampon du cabinet et numérotation des pièces',    icon: Stamp },
  { id: 'chronologie',   label: 'Chronologie',      hint: 'Frise des pièces du dossier',                     icon: CalendarClock },
];

function DossierSections({ section }: { section: SectionId }) {
  const { selectedCaseId, selectedCase } = useDossierCases();

  if (section === 'dossiers') return <CaseFilesSection />;
  if (section === 'tampon') return <StampingSection />;
  if (!selectedCaseId || !selectedCase) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Le dossier sélectionné dans la barre latérale n'est pas enregistré comme dossier juridique.
      </div>
    );
  }
  return <CaseFilesChronology caseId={selectedCaseId} caseName={selectedCase.name} />;
}

export default function DossierPanel({ selectedProject }: { selectedProject: Project | null }) {
  const [section, setSection] = useState<SectionId>('dossiers');

  return (
    <DossierCasesProvider projectPath={selectedProject?.fullPath || selectedProject?.path || null}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 flex-nowrap items-center gap-3 overflow-x-auto border-b border-border/50 px-3 py-2">
          <PillBar
            role="tablist"
            aria-label="Sections du dossier"
            className="min-w-max shrink-0 border border-border/40 bg-muted/50"
          >
            {SECTIONS.map((entry) => {
              const isActive = entry.id === section;
              return (
                <Tooltip key={entry.id} content={entry.hint} position="bottom">
                  <Pill
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    isActive={isActive}
                    onClick={() => setSection(entry.id)}
                    className="h-8 px-2.5 py-[5px]"
                  >
                    <entry.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                    <span className="truncate">{entry.label}</span>
                  </Pill>
                </Tooltip>
              );
            })}
          </PillBar>
          <CaseMappingSetup />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <DossierSections section={section} />
        </div>
      </div>
    </DossierCasesProvider>
  );
}
