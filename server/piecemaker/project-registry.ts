import path from 'path';

import { projectsDb } from '@/modules/database/index.js';

const PUBLISH_INTERVAL_MS = 5000;

type PublishProjectSource = (sourceId: string, folders: string[] | null) => void;

export function startProjectRegistry(publishProjectSource: PublishProjectSource): () => void {
  const sourceId = `database:${path.resolve(process.env.DATABASE_PATH || 'auth.db')}`;
  let publishedSignature: string | null = null;

  const publishProjects = () => {
    const folders = [...projectsDb.getProjectPaths(), ...projectsDb.getArchivedProjectPaths()]
      .map((row) => row.project_path)
      .sort();
    const signature = folders.join('\n');
    if (signature === publishedSignature) return;
    publishProjectSource(sourceId, folders);
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
