import { useEffect, useSyncExternalStore } from 'react';

import { useOptionalProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';

import { cancelLegalCode, readLegalCodeStart, subscribeToLegalCode } from './legalCode';

const STEPS = [
  'Posez la question juridique du dossier dans la zone de saisie, puis envoyez.',
  'Legal Code la code en programme Catala, chaque condition fondée sur un article ou une décision lue sur Légifrance.',
  'Il rattache chaque prémisse à une pièce du dossier et à son extrait ; une prémisse sans pièce reste à prouver.',
  'Le volet Catala montre le graphe, les tests et la preuve du programme.',
];

export function LegalCodeIntro() {
  const project = useOptionalProjectMainState();
  const start = useSyncExternalStore(subscribeToLegalCode, readLegalCodeStart);
  const active = Boolean(start) && Boolean(project) && start?.projectId === project?.selectedProject?.projectId && start?.trigger === project?.newSessionTrigger;

  useEffect(() => {
    if (start && !active) cancelLegalCode();
  }, [start, active]);

  if (!active) return null;

  return (
    <div className="mt-6 rounded-lg border border-border/60 bg-muted/20 p-4 text-left">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        Legal Code
        <span className="rounded-full bg-violet-200/70 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-900 dark:bg-violet-300/30 dark:text-violet-100">
          beta
        </span>
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Un agent qui traduit votre analyse juridique en programme Catala vérifiable, élément par élément.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-foreground">
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] text-muted-foreground">
        Pour le reste, c’est une session classique : vous pouvez lui demander n’importe quoi sur le dossier.
      </p>
    </div>
  );
}
