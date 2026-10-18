const OPEN = '<CITATION_INSTRUCTION>';
const CLOSE = '</CITATION_INSTRUCTION>';
const INSTRUCTIONS = `${OPEN}
Analyse juridique (question de droit, application au dossier) : réponds en prose sans marqueur [n], puis termine par <CITATIONS>[…]</CITATIONS> et <RAISONNEMENT>…</RAISONNEMENT>, masqués à l'utilisateur. Conversation, résumé ou tâche technique : rien de tout cela.

CITATIONS : tableau JSON strict des sources lues dans ce tour, numérotées par ref. Article : {"ref":1,"kind":"article","article_id":"LEGIARTI…","quotes":[{"quote":"extrait exact"}]} (lu par consulter_article). Décision : "kind":"case","decision_id":"JURITEXT…" (lue par consulter_decision). Pièce ou doctrine : "kind":"document","doc_id":"chemin du .md","quotes":[{"page":1,"quote":"…"}]. Au plus 3 extraits courts, recopiés mot pour mot. [] si aucune nouvelle source.

RAISONNEMENT : code Catala (syntaxe française), réécrit en entier à chaque tour. Une question = un champ d'application dont le résultat y répond exactement ; les faits sont fixés dans le champ Dossier.
#[question = "La société peut-elle … ?"]
#[objectif = rempli]
#[date_de_référence = date_acte]
déclaration champ d'application Nom:
  entrée date_acte contenu date
  entrée societe_cotee contenu booléen
  interne personne condition
  résultat effet condition
champ d'application Nom:
  #[libellé = "Condition telle que posée par le texte"] #[selon = 1]
  règle personne sous condition societe_cotee conséquence rempli
  #[selon = 1]
  règle effet sous condition personne et … conséquence rempli
déclaration champ d'application Dossier:
  nom champ Nom
champ d'application Dossier:
  #[selon = 3] #[force = acte_sous_seing_privé] #[appréciation = "ce que la pièce établit et ses limites"]
  définition nom.societe_cotee égal à vrai

Droit : pose TOUTES les conditions nécessaires à la réponse, une règle par condition, chacune avec #[libellé] et #[selon] vers le texte qui la pose. Toujours : la date de référence (le serveur contrôle la vigueur de l'article à cette date ; #[à_la_date = autre_date] sur une règle pour une autre date) et les conditions tenant à la personne. Condition imprécise dans le texte : cite aussi la décision qui l'interprète, à défaut la doctrine. Un raisonnement partiel est accepté ; complète-le au fil des tours.
Objectif : #[objectif = rempli|non rempli] = le résultat recherché pour le client. Chaque fondement qui mène au résultat est une règle distincte sur le résultat, avec son #[libellé] ; les moyens que l'adversaire opposera sont des exceptions de conséquence contraire.
Faits : chaque entrée reçoit sa valeur par une définition dans Dossier, prouvée par la pièce dont l'extrait répond directement à la condition (#[selon]), avec #[force] (acte_authentique, acte_sous_seing_privé, commencement_de_preuve, indice, sans_valeur) et #[appréciation]. Sans pièce, ne définis pas l'entrée : cherche la pièce (SQL, lecture des pièces).
Syntaxe : et, ou, non, si … alors … sinon …, = != < <= > >= + - * /, vrai, faux, |AAAA-MM-JJ|, 5 an, 2 mois, 10 jour ; définition x égal à expr ; étiquette base / exception base pour une dérogation. Source déjà enregistrée : #[selon = son identifiant].
L'avocat valide chaque élément ; un élément verrouillé se recopie à l'identique, toute modification est ignorée.
${CLOSE}`;

export function withCitationInstructions(command: string, programContext = '') {
  return `${command}\n\n${programContext ? INSTRUCTIONS.replace(CLOSE, `\n${programContext}\n${CLOSE}`) : INSTRUCTIONS}`;
}

export function withoutCitationInstructions(command: string) {
  if (!command.endsWith(CLOSE)) return command;
  const start = command.lastIndexOf(`\n\n${OPEN}\n`);
  return start < 0 ? command : command.slice(0, start);
}
