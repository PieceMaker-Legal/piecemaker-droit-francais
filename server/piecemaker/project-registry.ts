import path from 'path';

import { projectsDb } from '@/modules/database/index.js';

const PUBLISH_INTERVAL_MS = 5000;

type PublishProjectSource = (sourceId: string, folders: string[] | null, anonymizedFolders?: string[]) => void;

export function startProjectRegistry(publishProjectSource: PublishProjectSource): () => void {
  const sourceId = `database:${path.resolve(process.env.DATABASE_PATH || 'auth.db')}`;
  let publishedSignature: string | null = null;

  const publishProjects = () => {
    const rows = [...projectsDb.getProjectPaths(), ...projectsDb.getArchivedProjectPaths()];
    const folders = rows.map((row) => row.project_path).sort();
    const anonymizedFolders = rows.filter((row) => row.anonymization_complete).map((row) => row.project_path).sort();
    const signature = `${folders.join('\n')}\n--\n${anonymizedFolders.join('\n')}`;
    if (signature === publishedSignature) return;
    publishProjectSource(sourceId, folders, anonymizedFolders);
    publishedSignature = signature;
  };

  const publishProjectsSafely = () => {
    try {
      publishProjects();
    } catch (error) {
      console.error('[PieceMaker] Publication des projets impossible :', error);
    }
  };

  publishProjectsSafely();
  setInterval(publishProjectsSafely, PUBLISH_INTERVAL_MS).unref();
  return publishProjectsSafely;
}
