import { useOptionalProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import type { Project } from '@/shared/types';

import { startLegalCode } from './legalCode';

type LegalCodeButtonProps = {
  project: Project;
  onNewSession: (project: Project) => void;
};

export function LegalCodeButton({ project, onNewSession }: LegalCodeButtonProps) {
  const newSessionTrigger = useOptionalProjectMainState()?.newSessionTrigger ?? 0;

  return (
    <button
      type="button"
      className="flex h-8 w-full items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      onClick={() => {
        onNewSession(project);
        startLegalCode(project.projectId, newSessionTrigger + 1);
      }}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="m6 6 12 2M6 6l3 13M18 8 9 19" />
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="8" r="3" />
        <circle cx="9" cy="19" r="3" />
      </svg>
      Legal Code
      <span className="ml-auto rounded-full bg-violet-200/70 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-900 dark:bg-violet-300/30 dark:text-violet-100">
        beta
      </span>
    </button>
  );
}
