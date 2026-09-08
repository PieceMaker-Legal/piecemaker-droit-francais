import { useTranslation } from 'react-i18next';

import { ADDONS_PAGES, setAddonsPage, useAddonsPage } from '@/piecemaker/addons/page';
import { Button } from '@/shared/ui';
import '@/piecemaker/addons/workspace.css';

export function AddonsSidebarNav() {
  const { t } = useTranslation('addons');
  const page = useAddonsPage();

  return (
    <nav data-pm-addons-nav="true" aria-label={t('nav.sidebarLabel')} className="flex flex-col gap-1 px-2 pt-1.5">
      {ADDONS_PAGES.map((entry) => (
        <Button
          key={entry.path}
          size="sm"
          variant={page === entry.path ? 'secondary' : 'ghost'}
          onClick={() => setAddonsPage(entry.path)}
          aria-current={page === entry.path ? 'page' : undefined}
          className="w-full justify-start px-2.5 text-muted-foreground hover:text-foreground"
        >
          <img src={`/piecemaker/addons/${entry.icon}.svg`} className="h-3.5 w-3.5 grayscale" alt="" />
          <span className="text-sm">{t(`nav.${entry.id}`)}</span>
        </Button>
      ))}
    </nav>
  );
}
