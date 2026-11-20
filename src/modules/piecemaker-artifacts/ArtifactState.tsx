import { FileText, Loader2 } from 'lucide-react';

import { Button } from '@/shared/ui';

export function ArtifactState({ error, retry, empty }: { error?: string; retry?: () => void; empty?: string }) {
  if (error) return (
    <div role="alert" className="flex flex-wrap items-center gap-2 p-3 text-sm text-destructive">
      <span>{error}</span>
      {retry && <Button size="sm" variant="outline" onClick={retry}>Réessayer</Button>}
    </div>
  );
  if (empty) return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50"><FileText className="size-7" aria-hidden="true" /></div>
      <p>{empty}</p>
    </div>
  );
  return (
    <div role="status" className="flex flex-1 items-center justify-center gap-2 p-3 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" /> Chargement…
    </div>
  );
}
