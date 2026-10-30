import type { WorkspaceContext } from '@/modules/piecemaker-context-suggestions/contextStore';

export function mention(path: string, project: string | null) {
  const relative = project && path.startsWith(`${project}/`) ? path.slice(project.length + 1) : path;
  return /\s/.test(relative) ? `@"${relative}"` : `@${relative}`;
}

export function suggestQuestion(context: WorkspaceContext): string | null {
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
    case 'plugin:piecemaker-tabular-review':
      if (focus?.view === 'index') return 'Vérifie l’index du dossier : dates manquantes, incohérences et trous.';
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
