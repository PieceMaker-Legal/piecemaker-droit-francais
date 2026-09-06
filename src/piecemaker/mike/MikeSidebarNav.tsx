import { setMikePage, useMikePage } from '@/piecemaker/mike/page';
import '@/piecemaker/mike/workspace.css';

const entries = [
  { path: '/workflows', title: 'Workflows', icon: 'workflow' },
  { path: '/tabular-reviews', title: 'Tabular review', icon: 'tabular-review' },
  { path: '/library', title: 'Library', icon: 'library' },
  { path: '/organisation', title: 'Organisation', icon: 'organization' },
];

export function MikeSidebarNav() {
  const page = useMikePage();

  return (
    <nav data-pm-mike-nav="true" aria-label="Espaces PieceMaker" className="flex flex-col gap-1 px-2 pt-1.5">
      {entries.map((entry) => (
        <button
          key={entry.path}
          type="button"
          onClick={() => setMikePage(entry.path)}
          aria-current={page === entry.path ? 'page' : undefined}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <img src={`/piecemaker/mike/${entry.icon}.svg`} className="h-3.5 w-3.5 grayscale" alt="" />
          <span className="text-sm">{entry.title}</span>
        </button>
      ))}
    </nav>
  );
}
