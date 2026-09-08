import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { DossierCasesProvider } from '@/piecemaker/dossier/DossierContext';
import SkillsSection from '@/piecemaker/dossier/sections/SkillsSection';
import ConfigurationSection from '@/piecemaker/dossier/sections/ConfigurationSection';

export function Organisation({ projectPath }: { projectPath: string | null }) {
  const { t } = useTranslation('addons');
  const [section, setSection] = useState<'skills' | 'configuration'>('skills');
  return (
    <DossierCasesProvider projectPath={projectPath}>
      <div className="flex h-full flex-col">
        <header className="border-b border-border px-6 py-4">
          <h1 className="text-xl font-semibold">{t('nav.organisation')}</h1>
          <div className="mt-4 flex gap-2" role="tablist" aria-label={t('nav.organisation')}>
            <Button role="tab" aria-selected={section === 'skills'} variant={section === 'skills' ? 'secondary' : 'ghost'} onClick={() => setSection('skills')}>{t('organisation.skillsTab')}</Button>
            <Button role="tab" aria-selected={section === 'configuration'} variant={section === 'configuration' ? 'secondary' : 'ghost'} onClick={() => setSection('configuration')}>{t('organisation.configTab')}</Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{section === 'skills' ? <SkillsSection /> : <ConfigurationSection />}</div>
      </div>
    </DossierCasesProvider>
  );
}
