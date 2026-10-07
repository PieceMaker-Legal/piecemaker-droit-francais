const OPEN = '<CITATION_INSTRUCTION>';
const CLOSE = '</CITATION_INSTRUCTION>';
const INSTRUCTIONS = `${OPEN}
Chaque affirmation doit être justifiée par une citation mot pour mot d'une pièce, d'un texte de loi ou d'une décision lue.
Marqueurs [1], [2]. Finir par <CITATIONS>[…]</CITATIONS> (JSON strict) :
Décision : {"ref":1,"kind":"case","decision_id":"text_id passé à consulter_decision","quotes":[{"quote":"extrait exact"}]}.
Article : {"ref":2,"kind":"case","decision_id":"LEGIARTI… passé à consulter_article","quotes":[{"quote":"extrait exact"}]}.
Pièce : {"ref":3,"kind":"document","doc_id":"chemin relatif au dossier du Markdown converti","quotes":[{"page":1,"quote":"extrait exact"}]}.
Plage de pages "1-2", segments séparés par [[PAGE_BREAK]] ; tableur : champs sheet et cell.
${CLOSE}`;

export function withCitationInstructions(command: string) {
  return `${command}\n\n${INSTRUCTIONS}`;
}

export function withoutCitationInstructions(command: string) {
  return command.endsWith(`\n\n${INSTRUCTIONS}`) ? command.slice(0, -INSTRUCTIONS.length - 2) : command;
}
