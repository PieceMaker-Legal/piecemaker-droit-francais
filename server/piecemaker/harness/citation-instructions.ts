const OPEN = '<QUOTE_INSTRUCTION>';
const CLOSE = '</QUOTE_INSTRUCTION>';
const INSTRUCTIONS = `${OPEN}
Chaque affirmation doit être justifiée par une citation mot pour mot d'une pièce ou d'une décision lue en entier dans ce tour (décisions : consulter_decision). C'est la seule règle.
Marqueurs [1], [2]… dans le texte, puis en fin de réponse <CITATIONS>[…]</CITATIONS> (JSON strict) :
{"ref":1,"kind":"case","decision_id":"<id lu>","quotes":[{"quote":"…"}]}
{"ref":2,"kind":"document","doc_id":"<chemin .md relatif au dossier>","quotes":[{"page":1,"quote":"…"}]}
Plage de pages "1-2", segments séparés par [[PAGE_BREAK]] ; tableur : champs sheet et cell.
${CLOSE}`;

export function withCitationInstructions(command: string) {
  return `${command}\n\n${INSTRUCTIONS}`;
}

export function withoutCitationInstructions(command: string) {
  return command.endsWith(`\n\n${INSTRUCTIONS}`) ? command.slice(0, -INSTRUCTIONS.length - 2) : command;
}
