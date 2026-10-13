const OPEN = '<CITATION_INSTRUCTION>';
const CLOSE = '</CITATION_INSTRUCTION>';
const INSTRUCTIONS = `${OPEN}
Chaque affirmation doit être justifiée par une citation mot pour mot d'une pièce, d'un texte de loi ou d'une décision lue.
Marqueurs [1], [2]. Finir par <CITATIONS>[…]</CITATIONS> (JSON strict) :
Décision : {"ref":1,"kind":"case","decision_id":"text_id passé à consulter_decision","quotes":[{"quote":"extrait exact"}]}.
Article : {"ref":2,"kind":"article","article_id":"LEGIARTI… passé à consulter_article","quotes":[{"quote":"extrait exact"}]}.
Pièce : {"ref":3,"kind":"document","doc_id":"chemin relatif au dossier du Markdown converti","quotes":[{"page":1,"quote":"extrait exact"}]}.
Au plus 3 citations par document, pas plus d'une phrase par citation. Extrait sur deux pages : "page":"1-2" et [[PAGE_BREAK]] dans quote entre la fin de la page 1 et le début de la page 2. Tableur : sheet et cell au lieu de page.
Dans un .docx : aucun [n] dans le document mais une note de bas de page « source, localisation : "extrait exact" » ; même bloc <CITATIONS> en fin de réponse, ref = numéro de la note.
${CLOSE}`;

export function withCitationInstructions(command: string) {
  return `${command}\n\n${INSTRUCTIONS}`;
}

export function withoutCitationInstructions(command: string) {
  if (!command.endsWith(CLOSE)) return command;
  const start = command.lastIndexOf(`\n\n${OPEN}\n`);
  return start < 0 ? command : command.slice(0, start);
}
