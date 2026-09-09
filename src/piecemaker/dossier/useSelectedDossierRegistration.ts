import { useEffect } from 'react';

import { pmGetCached } from '@/piecemaker/dossier/api';
import { ensureDossierRegistration } from '@/piecemaker/dossier/dossierRegistration';
import type { Project } from '@/shared/types';

export function useSelectedDossierRegistration(selectedProject: Project | null): void {
  const projectPath = selectedProject?.fullPath || selectedProject?.path;

  useEffect(() => {
    if (!projectPath) return;
    void ensureDossierRegistration(projectPath)
      .then(({ selectedCase }) => {
        if (!selectedCase) return;
        const caseQuery = { case: selectedCase.path };
        void Promise.allSettled([
          pmGetCached('/repository/case', caseQuery),
          pmGetCached('/mapping', caseQuery),
          pmGetCached('/repository/chronology', caseQuery),
          pmGetCached('/configuration'),
        ]);
      })
      .catch((error) => {
        console.error('Impossible d’enregistrer le dossier juridique sélectionné.', error);
      });
  }, [projectPath]);
}
