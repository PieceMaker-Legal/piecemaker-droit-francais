import { useCallback, useSyncExternalStore } from 'react';

import { MarkdownContent } from '@/modules/chat/tools/ContentRenderers/MarkdownContent';
import { readPlan, subscribePlans } from '@/piecemaker/editor-tabs/editorPanels';

export function PlanTab({ id }: { id: string }) {
  const markdown = useSyncExternalStore(subscribePlans, useCallback(() => readPlan(id), [id]));
  return (
    <div className="h-full min-w-0 overflow-auto bg-background p-4">
      {markdown
        ? <MarkdownContent content={markdown} className="prose prose-sm max-w-none dark:prose-invert" />
        : <p role="status" className="text-sm text-muted-foreground">Ce plan n’est plus disponible.</p>}
    </div>
  );
}
