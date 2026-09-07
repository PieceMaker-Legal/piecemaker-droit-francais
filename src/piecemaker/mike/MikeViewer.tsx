import { ChevronLeft } from 'lucide-react';

import { Button } from '@/shared/ui';
import { Organisation } from '@/piecemaker/mike/Organisation';
import { MIKE_PAGES, setMikePage, useMikePage } from '@/piecemaker/mike/page';
import { AddonsPage } from '@/piecemaker/mike/pages/AddonsPage';
import { LibraryPage } from '@/piecemaker/mike/pages/LibraryPage';
import { TabularReviewsPage } from '@/piecemaker/mike/pages/TabularReviewsPage';
import { WorkflowsPage } from '@/piecemaker/mike/pages/WorkflowsPage';
import '@/piecemaker/mike/workspace.css';

function getPageTitle(page: string) {
  return MIKE_PAGES.find((entry) => entry.path === page)?.title ?? 'Espace Mike';
}

export function MikeViewer({ projectPath }: { projectPath?: string | null }) {
  const page = useMikePage();

  if (!page) return null;
  return (
    <section data-pm-mike-viewer="true" aria-label="Espace PieceMaker" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => setMikePage(null)}><ChevronLeft className="h-4 w-4" />{projectPath ? 'Revenir à la session' : 'Revenir à l’accueil'}</Button>
        <div className="h-5 border-l border-border/60" aria-hidden="true" />
        <nav aria-label="Navigation Mike" className="flex flex-wrap items-center gap-1">
          {MIKE_PAGES.map((entry) => <Button key={entry.path} size="sm" variant={page === entry.path ? 'secondary' : 'ghost'} onClick={() => setMikePage(entry.path)} aria-current={page === entry.path ? 'page' : undefined}>{entry.title}</Button>)}
        </nav>
        <h1 className="ml-auto text-sm font-medium">{getPageTitle(page)}</h1>
      </div>
      <div className="relative min-h-0 flex-1">
        {page === '/workflows' && <WorkflowsPage projectPath={projectPath ?? null} />}
        {page === '/workflow-addons' && <AddonsPage projectPath={projectPath ?? null} />}
        {page === '/library' && <LibraryPage />}
        {page === '/tabular-reviews' && <TabularReviewsPage />}
        {page === '/organisation' && <Organisation projectPath={projectPath ?? null} />}
      </div>
    </section>
  );
}
