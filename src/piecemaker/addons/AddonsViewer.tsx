import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { Organisation } from '@/piecemaker/addons/Organisation';
import { ADDONS_PAGES, setAddonsPage, useAddonsPage } from '@/piecemaker/addons/page';
import { LibraryPage } from '@/piecemaker/addons/pages/LibraryPage';
import { TabularReviewsPage } from '@/piecemaker/addons/pages/TabularReviewsPage';
import { WorkflowsPage } from '@/piecemaker/addons/pages/WorkflowsPage';
import '@/piecemaker/addons/workspace.css';

export function AddonsViewer({ projectPath }: { projectPath?: string | null }) {
  const { t } = useTranslation('addons');
  const page = useAddonsPage();

  if (!page) return null;
  const pageId = ADDONS_PAGES.find((entry) => entry.path === page)?.id;
  const pageTitle = pageId ? t(`nav.${pageId}`) : t('viewer.workspaceLabel');
  return (
    <section data-pm-addons-viewer="true" aria-label={t('viewer.workspaceLabel')} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => setAddonsPage(null)}><ChevronLeft className="h-4 w-4" />{projectPath ? t('viewer.backToSession') : t('viewer.backToHome')}</Button>
        <div className="h-5 border-l border-border/60" aria-hidden="true" />
        <nav aria-label={t('viewer.nav')} className="flex flex-wrap items-center gap-1">
          {ADDONS_PAGES.map((entry) => <Button key={entry.path} size="sm" variant={page === entry.path ? 'secondary' : 'ghost'} onClick={() => setAddonsPage(entry.path)} aria-current={page === entry.path ? 'page' : undefined}>{t(`nav.${entry.id}`)}</Button>)}
        </nav>
        <h1 className="ml-auto text-sm font-medium">{pageTitle}</h1>
      </div>
      <div className="relative min-h-0 flex-1">
        {page === '/workflows' && <WorkflowsPage projectPath={projectPath ?? null} />}
        {page === '/library' && <LibraryPage />}
        {page === '/tabular-reviews' && <TabularReviewsPage />}
        {page === '/organisation' && <Organisation projectPath={projectPath ?? null} />}
      </div>
    </section>
  );
}
