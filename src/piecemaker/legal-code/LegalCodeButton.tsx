import { Scale } from 'lucide-react';

import type { Project } from '@/shared/types';

import { prefillLegalCode } from './legalCode';

type LegalCodeButtonProps = {
  project: Project;
  onNewSession: (project: Project) => void;
};

export function LegalCodeButton({ project, onNewSession }: LegalCodeButtonProps) {
  return (
    <button
      type="button"
      className="flex h-8 w-full items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      onClick={() => {
        onNewSession(project);
        prefillLegalCode(project.projectId);
      }}
    >
      <Scale className="h-3 w-3" />
      Legal Code
      <span className="ml-auto rounded-full bg-violet-200/70 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-900 dark:bg-violet-300/30 dark:text-violet-100">
        beta
      </span>
    </button>
  );
}
