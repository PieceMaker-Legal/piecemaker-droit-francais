import { ChevronLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { AddonsAsyncState } from '@/piecemaker/addons/pages/AddonsAsyncState';
import type { AddonsTabularCellFlag, AddonsTabularCellStatus, AddonsTabularReview, AddonsTabularReviewDetail } from '@/piecemaker/addons/types';
import { useAddonsData } from '@/piecemaker/addons/useAddonsData';

const dateFormatter = new Intl.DateTimeFormat('fr-FR');

const FLAG_DOT_CLASS: Record<AddonsTabularCellFlag, string> = {
  green: 'bg-green-500',
  grey: 'bg-muted-foreground',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return dateFormatter.format(parsed);
}

export function TabularReviewsPage() {
  const { t } = useTranslation('addons');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const FLAG_LABEL: Record<AddonsTabularCellFlag, string> = {
    green: t('tabularReview.flag.green'),
    grey: t('tabularReview.flag.grey'),
    yellow: t('tabularReview.flag.yellow'),
    red: t('tabularReview.flag.red'),
  };

  const STATUS_LABEL: Record<AddonsTabularCellStatus, string> = {
    pending: t('tabularReview.status.pending'),
    generating: t('tabularReview.status.generating'),
    error: t('tabularReview.status.error'),
    done: '',
  };

  const reviewTitle = (review: AddonsTabularReview): string => review.title?.trim() || t('tabularReview.untitled');

  const list = useAddonsData<AddonsTabularReview[]>('/tabular-review');
  const detail = useAddonsData<AddonsTabularReviewDetail>(selectedId ? `/tabular-review/${selectedId}` : null);

  const cellByKey = useMemo(() => {
    const lookup = new Map<string, AddonsTabularReviewDetail['cells'][number]>();
    for (const cell of detail.data?.cells ?? []) {
      lookup.set(`${cell.row_id}:${cell.column_index}`, cell);
    }
    return lookup;
  }, [detail.data]);

  if (selectedId === null) {
    const reviews = list.data ?? [];
    const isEmpty = !list.loading && !list.error && reviews.length === 0;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <AddonsAsyncState
          loading={list.loading}
          loadingLabel={t('tabularReview.loadingList')}
          error={list.error}
          onRetry={list.reload}
          empty={isEmpty}
          emptyLabel={t('tabularReview.noReviews')}
        />
        {!list.loading && !list.error && !isEmpty && (
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {reviews.map((review) => (
              <button
                key={review.id}
                type="button"
                onClick={() => setSelectedId(review.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-medium">{reviewTitle(review)}</span>
                  {review.is_running && <Badge variant="secondary">{t('tabularReview.running')}</Badge>}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span>{t('tabularReview.documentCount', { count: review.document_count ?? 0, plural: (review.document_count ?? 0) > 1 ? 's' : '' })}</span>
                  <span>{formatDate(review.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const reviewDetail = detail.data;
  const columns = reviewDetail?.review.columns_config ?? [];
  const rows = [...(reviewDetail?.rows ?? [])].sort((a, b) => a.sort_index - b.sort_index);
  const isEmpty = !detail.loading && !detail.error && rows.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-3">
        <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
          <ChevronLeft className="h-4 w-4" />
          {t('tabularReview.backToList')}
        </Button>
        {reviewDetail && <h2 className="text-sm font-medium">{reviewTitle(reviewDetail.review)}</h2>}
      </div>
      <AddonsAsyncState
        loading={detail.loading}
        loadingLabel={t('tabularReview.loadingDetail')}
        error={detail.error}
        onRetry={detail.reload}
        empty={isEmpty}
        emptyLabel={t('tabularReview.noRows')}
      />
      {!detail.loading && !detail.error && !isEmpty && (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border-b border-r border-border/40 bg-background px-3 py-2 text-left font-medium">{t('tabularReview.itemColumn')}</th>
                {columns.map((column) => (
                  <th key={column.index} className="sticky top-0 z-10 min-w-48 border-b border-border/40 bg-background px-3 py-2 text-left font-medium">
                    {column.name || t('tabularReview.columnFallback', { index: column.index })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/20">
                  <td className="sticky left-0 z-10 border-r border-border/40 bg-background px-3 py-2 font-medium">{row.label}</td>
                  {columns.map((column) => {
                    const cell = cellByKey.get(`${row.id}:${column.index}`);
                    const pendingStatus = cell?.status;
                    return (
                      <td key={column.index} className="px-3 py-2 align-top">
                        {!cell || pendingStatus !== 'done' ? (
                          <span className="text-xs text-muted-foreground">{STATUS_LABEL[pendingStatus ?? 'pending']}</span>
                        ) : (
                          <div className="flex items-start gap-2">
                            {cell.content?.flag && (
                              <span
                                role="img"
                                aria-label={FLAG_LABEL[cell.content.flag]}
                                title={FLAG_LABEL[cell.content.flag]}
                                className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', FLAG_DOT_CLASS[cell.content.flag])}
                              />
                            )}
                            <span>{cell.content?.summary}</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
