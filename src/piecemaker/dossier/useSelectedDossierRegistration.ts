import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ensureDossierRegistration } from '@/piecemaker/dossier/dossierRegistration';
import type { Project } from '@/shared/types';
import { publishWorkflowSessionBridge } from '@/piecemaker/addons/sessionBridge';

export function useSelectedDossierRegistration(selectedProject: Project | null): void {
  const projectPath = selectedProject?.fullPath || selectedProject?.path;
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { publishWorkflowSessionBridge({ projectPath: projectPath ?? null, pathname: location.pathname, navigate }); }, [location.pathname, navigate, projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    void ensureDossierRegistration(projectPath).catch((error) => {
      console.error('Impossible d’enregistrer le dossier juridique sélectionné.', error);
    });
  }, [projectPath]);
}
