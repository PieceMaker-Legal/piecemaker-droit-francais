const OPEN = '<CITATION_INSTRUCTION>';
const CLOSE = '</CITATION_INSTRUCTION>';
const INSTRUCTIONS = `${OPEN}
Chaque affirmation juridique ou factuelle s'appuie sur un passage exact lu. Réponse : marqueurs [1…N], puis un unique bloc final <CITATIONS>JSON</CITATIONS>. Le contenu doit être exactement un tableau JSON valide, sans texte, objet enveloppe, bloc Markdown ni caractère après le tableau. Exemple de forme : [{"ref":1,"kind":"document","doc_id":"chemin/relatif.md","quotes":[{"page":1,"quote":"extrait exact"}]}]. Les types de source : case + decision_id, article + article_id, document/code + doc_id. Chacun porte ref et quotes (max 3 passages courts) ; chaque quote contient le texte exact, page ou sheet/cell si pièce. Citation de décision/article : identifiant lu via l'outil correspondant. Citation de pièce : chemin de sa version Markdown. Code : chemin relatif au dépôt. Dans un DOCX, pas de marqueur dans le fichier : note de bas de page avec source, emplacement et extrait exact ; ref = numéro de note.
${CLOSE}`;

export function withCitationInstructions(command: string) {
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
