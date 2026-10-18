import { useSyncExternalStore } from 'react';

import { useProjectCommandState } from '@/modules/project-workspace/context/ProjectsStateContext';

import { subscribeToChatDrafts } from '@/shared/chatDrafts';

import { isLegalCodeDraft } from './legalCode';

const STEPS = [
  'Posez la question juridique du dossier à la suite de /legal-code, puis envoyez.',
  'Legal Code la découpe en conditions, chacune fondée sur un article ou une décision lue sur Légifrance.',
  'Il rattache chaque fait à une pièce du dossier et à son extrait ; un fait sans pièce reste « à rechercher ».',
  'Le volet Raisonnement montre le graphe, le détail et le test : la question, en droit, en fait, conclusion.',
  'Vous validez, écartez ou corrigez chaque élément ; une fois décidé, il est verrouillé pour l’agent.',
];

export function LegalCodeIntro() {
  const { selectedProject } = useProjectCommandState();
  const projectId = selectedProject?.projectId ?? '';
  const active = useSyncExternalStore(subscribeToChatDrafts, () => Boolean(projectId) && isLegalCodeDraft(projectId));

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
        Un agent qui traduit votre analyse juridique en raisonnement vérifiable, élément par élément.
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
