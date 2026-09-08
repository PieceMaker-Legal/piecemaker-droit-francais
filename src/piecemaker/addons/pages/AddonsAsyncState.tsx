import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type AddonsAsyncStateProps = {
  loading: boolean;
  loadingLabel: string;
  error: string;
  onRetry: () => void;
  empty?: boolean;
  emptyLabel?: string;
};

export function AddonsAsyncState({ loading, loadingLabel, error, onRetry, empty, emptyLabel }: AddonsAsyncStateProps) {
  const { t } = useTranslation('addons');
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
        <Button onClick={onRetry}>{t('common.retry')}</Button>
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
