import { useState } from 'react';

import { Button } from '@/shared/ui';
import { DossierCasesProvider } from '@/piecemaker/dossier/DossierContext';
import SkillsSection from '@/piecemaker/dossier/sections/SkillsSection';
import ConfigurationSection from '@/piecemaker/dossier/sections/ConfigurationSection';

export function Organisation({ projectPath }: { projectPath: string | null }) {
  const [section, setSection] = useState<'skills' | 'configuration'>('skills');
  return (
    <DossierCasesProvider projectPath={projectPath}>
      <div className="flex h-full flex-col">
        <header className="border-b border-border px-6 py-4">
          <h1 className="text-xl font-semibold">Organisation</h1>
          <div className="mt-4 flex gap-2" role="tablist" aria-label="Organisation">
            <Button role="tab" aria-selected={section === 'skills'} variant={section === 'skills' ? 'secondary' : 'ghost'} onClick={() => setSection('skills')}>Skills et agents</Button>
            <Button role="tab" aria-selected={section === 'configuration'} variant={section === 'configuration' ? 'secondary' : 'ghost'} onClick={() => setSection('configuration')}>MCP et configuration</Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{section === 'skills' ? <SkillsSection /> : <ConfigurationSection />}</div>
      </div>
    </DossierCasesProvider>
  );
}
