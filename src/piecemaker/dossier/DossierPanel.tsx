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
import { FolderTree, Stamp, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react';

import { PillBar, Pill, Tooltip } from '@/shared/ui';
import type { Project } from '@/shared/types';
import { DossierCasesProvider } from '@/piecemaker/dossier/DossierContext';
import CaseFilesSection from '@/piecemaker/dossier/sections/CaseFilesSection';
import StampingSection from '@/piecemaker/dossier/sections/StampingSection';
import ConfigurationSection from '@/piecemaker/dossier/sections/ConfigurationSection';
import SkillsSection from '@/piecemaker/dossier/sections/SkillsSection';

type SectionId = 'dossiers' | 'tampon' | 'configuration' | 'skills';

const SECTIONS: { id: SectionId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'dossiers',      label: 'Général',         hint: 'Pièces, mapping, parties et chronologie',           icon: FolderTree },
  { id: 'tampon',        label: 'Tampon et pièces', hint: 'Tampon du cabinet et numérotation des pièces',    icon: Stamp },
  { id: 'configuration', label: 'Configuration',    hint: 'Carte des composants installés',                  icon: SlidersHorizontal },
  { id: 'skills',        label: 'Skills et agents', hint: 'Skills, agents et plugins Claude Code',            icon: Sparkles },
];

export default function DossierPanel({ selectedProject }: { selectedProject: Project | null }) {
  const [section, setSection] = useState<SectionId>('dossiers');

  return (
    <DossierCasesProvider projectPath={selectedProject?.fullPath || selectedProject?.path || null}>
      <div className="flex h-full flex-col">
        <div className="shrink-0 overflow-x-auto border-b border-border/50 px-3 py-2">
          <PillBar
            role="tablist"
            aria-label="Sections du dossier"
            className="min-w-max border border-border/40 bg-muted/50"
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {section === 'dossiers' && <CaseFilesSection />}
          {section === 'tampon' && <StampingSection />}
          {section === 'configuration' && <ConfigurationSection />}
          {section === 'skills' && <SkillsSection />}
        </div>
      </div>
    </DossierCasesProvider>
  );
}
