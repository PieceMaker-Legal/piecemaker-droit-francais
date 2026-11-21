import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, CircleDashed, Contrast } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import type { SessionActivityState, SessionStateGroup } from '@/modules/piecemaker-session-groups/sessionStateGroups';

const STATE_LABEL_DEFAULTS: Record<SessionActivityState, string> = {
  attention: 'Waiting on you',
  running: 'Running',
  idle: 'Idle',
};

function SessionStateIcon({ state }: { state: SessionActivityState }) {
  if (state === 'attention') {
    return <Contrast className="h-3 w-3 flex-shrink-0 text-amber-500" aria-hidden="true" />;
  }
  if (state === 'running') {
    return (
      <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center" aria-hidden="true">
        <span className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />
      </span>
    );
  }
  return <CircleDashed className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" aria-hidden="true" />;
}

type SessionStateGroupsProps<Row> = {
  groups: SessionStateGroup<Row>[];
  rowKey: (row: Row) => string;
  renderRow: (row: Row) => ReactNode;
  className?: string;
  headerClassName?: string;
  rowsClassName?: string;
  testId?: string;
};

export function SessionStateGroups<Row>({
  groups,
  rowKey,
  renderRow,
  className,
  headerClassName,
  rowsClassName,
  testId,
}: SessionStateGroupsProps<Row>) {
  const { t } = useTranslation('sidebar');
  const [collapsedStates, setCollapsedStates] = useState<ReadonlySet<SessionActivityState>>(new Set());

  const toggle = (state: SessionActivityState) => setCollapsedStates((previous) => {
    const next = new Set(previous);
    if (next.has(state)) next.delete(state);
    else next.add(state);
    return next;
  });

  return (
    <div className={cn('space-y-1.5', className)} data-testid={testId}>
      {groups.map(({ state, rows }) => {
        const isCollapsed = collapsedStates.has(state);
        const label = t(`sessionGroups.${state}`, STATE_LABEL_DEFAULTS[state]);
        return (
          <section key={state} data-session-state={state} aria-label={label}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                headerClassName,
              )}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(state)}
            >
              <SessionStateIcon state={state} />
              <span className="truncate">{label}</span>
              <span className="tabular-nums text-muted-foreground/70">· {rows.length}</span>
              <ChevronDown
                className={cn('h-3 w-3 flex-shrink-0 transition-transform', isCollapsed && '-rotate-90')}
                aria-hidden="true"
              />
            </button>
            {!isCollapsed && (
              <div className={rowsClassName}>
                {rows.map((row) => <div key={rowKey(row)} className="contents">{renderRow(row)}</div>)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
