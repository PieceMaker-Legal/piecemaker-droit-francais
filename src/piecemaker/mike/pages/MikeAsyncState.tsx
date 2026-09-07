import { Loader2 } from 'lucide-react';

import { Button } from '@/shared/ui';

type MikeAsyncStateProps = {
  loading: boolean;
  loadingLabel: string;
  error: string;
  onRetry: () => void;
  empty?: boolean;
  emptyLabel?: string;
};

export function MikeAsyncState({ loading, loadingLabel, error, onRetry, empty, emptyLabel }: MikeAsyncStateProps) {
  if (loading) {
    return (
      <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {loadingLabel}
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p>{error}</p>
        <Button onClick={onRetry}>Réessayer</Button>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }
  return null;
}
