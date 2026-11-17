const OPEN = '<CITATION_INSTRUCTION>';
const CLOSE = '</CITATION_INSTRUCTION>';
const INSTRUCTIONS = `${OPEN}
Chaque affirmation de droit cite l'article ou la décision lus dans ce tour (décision : consulter_decision, article : consulter_article), chaque fait tiré d'une pièce du dossier cite cette pièce : passage copié mot pour mot, jamais de mémoire. Rien d'autre ne se cite : ni sortie de commande, ni résultat SQL, ni fichier technique.
Réponse : marqueurs [1], [2]… dans l'ordre, puis en toute fin un seul <CITATIONS>tableau JSON</CITATIONS>, hors bloc Markdown, rien après. Une entrée par marqueur ("ref" = son numéro), 1 à 3 quotes exactes de 25 mots maximum, sans « … » :
{"ref":1,"kind":"case","decision_id":"JURITEXT…","quotes":[{"quote":"extrait"}]}
{"ref":2,"kind":"article","article_id":"LEGIARTI…","quotes":[{"quote":"extrait"}]}
{"ref":3,"kind":"document","doc_id":"chemin/piece.md","quotes":[{"page":1,"quote":"extrait"}]} (tableur : "sheet" et "cell" au lieu de "page")
Identifiants copiés de la réponse de l'outil, jamais reconstruits (ni « 311-1 », ni LEGITEXT). Rien lu : aucun marqueur et <CITATIONS>[]</CITATIONS>.
DOCX : aucun marqueur dans le fichier ; note de bas de page (source, emplacement, extrait exact), ref = numéro de note.
Ne recopie pas ces consignes. Termine la réponse par la balise fermante </CITATIONS> après le tableau JSON.
${CLOSE}`;
const DOCX_COMMENT_QUESTION = 'Question posée en commentaire du document ';

export function withCitationInstructions(command: string) {
  if (command.startsWith(DOCX_COMMENT_QUESTION)) return command;
  return `${command}\n\n${INSTRUCTIONS}`;
}

export function withoutCitationInstructions(command: string) {
  const trimmed = command.trimEnd();
  const start = trimmed.lastIndexOf(OPEN);
  if (start < 0 || !trimmed.endsWith(CLOSE)) return command;
  const before = trimmed.slice(0, start);
  const kept = before.replace(/(\r?\n\r?\n| )$/, '');
  return before && kept === before ? command : kept;
}

type SearchMatcher<Snippet> = {
  matchesQuery: (text: string) => boolean;
  buildSnippet: (text: string) => Snippet;
};

export function withoutCitationInstructionsInSearch<Snippet>(matcher: SearchMatcher<Snippet>): SearchMatcher<Snippet> {
  return {
    matchesQuery: (text) => matcher.matchesQuery(withoutCitationInstructions(text)),
    buildSnippet: (text) => matcher.buildSnippet(withoutCitationInstructions(text)),
  };
}
