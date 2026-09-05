const OPEN = '<PIECEMAKER_CITATION_INSTRUCTIONS>';
const CLOSE = '</PIECEMAKER_CITATION_INSTRUCTIONS>';
const INSTRUCTIONS = `${OPEN}
Pour les citations de pièces et de jurisprudence : ne citer que des sources lues dans ce tour. Chercher, trier, puis lire les sources retenues avant de citer. Lire les décisions Légifrance avec consulter_decision : un titre, un sommaire ou Download_Query_Results ne vaut pas lecture du texte intégral.
Copier les extraits littéralement. Au plus 3 extraits par citation, chacun de 25 mots maximum. Utiliser les marqueurs [1], [2], etc., contigus et dans l'ordre de première apparition. Une entrée par référence ; réutiliser la référence pour la même citation.
Terminer toute réponse comportant ces citations par un bloc <CITATIONS> contenant un tableau JSON strict, puis </CITATIONS>. Sans citation, ne pas ajouter de bloc.
Décision : {"ref":1,"kind":"case","decision_id":"identifiant Legifrance lu","quotes":[{"quote":"extrait exact"}]}.
Pièce : {"ref":2,"kind":"document","doc_id":"chemin relatif au dossier du Markdown converti","quotes":[{"page":1,"quote":"extrait exact"}]}.
Une plage de pages prend la forme "1-2" ; [[PAGE_BREAK]] sépare les segments des deux pages. Les champs sheet et cell peuvent localiser une citation de tableur. Ne pas inventer une source indisponible ; expliquer qu'elle n'a pas pu être lue.
${CLOSE}`;

export function withCitationInstructions(command: string) {
  return `${command}\n\n${INSTRUCTIONS}`;
}

export function withoutCitationInstructions(command: string) {
  return command.endsWith(`\n\n${INSTRUCTIONS}`) ? command.slice(0, -INSTRUCTIONS.length - 2) : command;
}
