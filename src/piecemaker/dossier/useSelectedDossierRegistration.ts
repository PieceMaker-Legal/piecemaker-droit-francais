import { useEffect } from 'react';

import { activeProject, setActiveProjectId } from '@/piecemaker/chat/fileRef';
import { ensureDossierRegistration } from '@/piecemaker/dossier/dossierRegistration';
import type { Project } from '@/shared/types';

export function useSelectedDossierRegistration(selectedProject: Project | null): void {
  const projectPath = selectedProject?.fullPath || selectedProject?.path;
  const projectId = selectedProject?.projectId;

  useEffect(() => {
    const previous = activeProject();
    setActiveProjectId(projectId);
    return () => setActiveProjectId(previous);
  }, [projectId]);

  useEffect(() => {
    if (!projectPath) return;
    void ensureDossierRegistration(projectPath).catch((error) => {
      console.error('Impossible d’enregistrer le dossier juridique sélectionné.', error);
    });
  }, [projectPath]);
}
