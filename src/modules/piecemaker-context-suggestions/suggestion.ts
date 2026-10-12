import type { WorkspaceContext } from '@/modules/piecemaker-context-suggestions/contextStore';

export function mention(path: string, project: string | null) {
  const relative = project && path.startsWith(`${project}/`) ? path.slice(project.length + 1) : path;
  return /\s/.test(relative) ? `@"${relative}"` : `@${relative}`;
}

const EXTRA_QUESTIONS: Record<string, string[]> = {
  'plugin:piecemaker-library': ['Analyse les sessions passées et liste les skills qui pourraient être rédigés.'],
};

export function suggestQuestions(context: WorkspaceContext): string[] {
  const question = suggestQuestion(context);
  const extra = context.last?.kind === 'panel' ? EXTRA_QUESTIONS[context.last.tab] ?? [] : [];
  return question ? [question, ...extra] : [];
}

function suggestQuestion(context: WorkspaceContext): string | null {
  const { last, project } = context;
  if (!last) return null;
  if (last.kind === 'document') {
    const target = mention(last.path, project);
    return /\.docx?$/i.test(last.path)
      ? `Relis ${target} et propose-moi des corrections.`
      : `Résume ${target} et relève les points utiles au dossier.`;
  }
  const focus = context.focus[last.tab];
  switch (last.tab) {
    case 'files':
      return 'Propose-moi une réorganisation de mes documents en dossiers clairs.';
    case 'plugin:piecemaker-dossier':
      return focus?.view === 'chronology' ? 'Vérifie la chronologie du dossier : dates manquantes, incohérences et trous.' : null;
    case 'plugin:piecemaker-tabular-review':
      return focus?.file
        ? `Analyse le tableau ${mention(focus.file, project)} : quelles lignes méritent mon attention ?`
        : 'Prépare une analyse tabulaire des documents du dossier.';
    case 'plugin:piecemaker-library':
      return 'Écris une nouvelle skill pour ';
    case 'plugin:piecemaker-tampon':
      return 'Tamponne mes pièces.';
    default:
      return null;
  }
}
