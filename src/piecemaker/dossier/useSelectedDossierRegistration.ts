import { useEffect } from 'react';

import { setActiveProjectId } from '@/piecemaker/chat/fileRef';
import { ensureDossierRegistration } from '@/piecemaker/dossier/dossierRegistration';
import type { Project } from '@/shared/types';

export function useSelectedDossierRegistration(selectedProject: Project | null): void {
  const projectPath = selectedProject?.fullPath || selectedProject?.path;
  const projectId = selectedProject?.projectId;

  useEffect(() => {
    setActiveProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectPath) return;
    void ensureDossierRegistration(projectPath).catch((error) => {
      console.error('Impossible d’enregistrer le dossier juridique sélectionné.', error);
    });
  }, [projectPath]);
}
