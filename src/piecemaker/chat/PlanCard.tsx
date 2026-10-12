import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/modules/chat/context/PermissionContext';
import { showPlan } from '@/piecemaker/editor-tabs/planCalls';
import type { PlanCall } from '@/piecemaker/editor-tabs/planCalls';
import { Button } from '@/shared/ui';

const TITLES: Record<PlanCall['kind'], string> = {
  proposed: 'Plan proposé',
  written: 'Plan rédigé',
  edited: 'Plan modifié',
};

export function PlanCard({ plan, toolId }: { plan: PlanCall; toolId?: string }) {
  const { t } = useTranslation();
  const permission = usePermission();
  const pending = plan.kind === 'proposed'
    ? permission?.pendingPermissionRequests.find((request) => request.toolName === 'ExitPlanMode' || request.toolName === 'exit_plan_mode')
    : undefined;
  const decide = (allow: boolean) => {
    if (!pending || !permission) return;
    permission.handlePermissionDecision(pending.requestId, allow ? { allow } : { allow, message: t('chat:misc.userAskedRevise') });
  };

  return (
    <div className="my-1 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium">{TITLES[plan.kind]}</span>
      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => showPlan(plan, toolId || 'plan')}>
        Voir le plan
      </Button>
      {pending && (
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => decide(false)}>Réviser</Button>
          <Button size="sm" onClick={() => decide(true)}>Exécuter</Button>
        </div>
      )}
    </div>
  );
}
