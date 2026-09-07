import { MikeWelcomeViewer } from '@/piecemaker/mike/MikeWelcomeViewer';
import { MIKE_PAGES, setMikePage, useMikePage } from '@/piecemaker/mike/page';
import { Button } from '@/shared/ui';
import '@/piecemaker/mike/workspace.css';

export function MikeSidebarNav() {
  const page = useMikePage();

  return (
    <>
      <nav data-pm-mike-nav="true" aria-label="Espaces PieceMaker" className="flex flex-col gap-1 px-2 pt-1.5">
        {MIKE_PAGES.map((entry) => (
          <Button
            key={entry.path}
            size="sm"
            variant={page === entry.path ? 'secondary' : 'ghost'}
            onClick={() => setMikePage(entry.path)}
            aria-current={page === entry.path ? 'page' : undefined}
            className="w-full justify-start px-2.5 text-muted-foreground hover:text-foreground"
          >
            <img src={`/piecemaker/mike/${entry.icon}.svg`} className="h-3.5 w-3.5 grayscale" alt="" />
            <span className="text-sm">{entry.title}</span>
          </Button>
        ))}
      </nav>
      <MikeWelcomeViewer />
    </>
  );
}
