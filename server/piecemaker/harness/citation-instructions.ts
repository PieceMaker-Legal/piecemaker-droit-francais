const OPEN = '<CITATION_INSTRUCTION>';
const CLOSE = '</CITATION_INSTRUCTION>';
const INSTRUCTIONS = `${OPEN}
Chaque affirmation doit être justifiée par une citation mot pour mot d'une pièce, d'un texte de loi ou d'une décision lue.
Marqueurs [1], [2]. Finir par <CITATIONS>[…]</CITATIONS> (JSON strict) :
Décision : {"ref":1,"kind":"case","decision_id":"text_id passé à consulter_decision","quotes":[{"quote":"extrait exact"}]}.
Article : {"ref":2,"kind":"article","article_id":"LEGIARTI… passé à consulter_article","quotes":[{"quote":"extrait exact"}]}.
Pièce : {"ref":3,"kind":"document","doc_id":"chemin relatif au dossier du Markdown converti","quotes":[{"page":1,"quote":"extrait exact"}]}.
Code (pour une affirmation sur le dépôt applicatif) : {"ref":4,"kind":"code","doc_id":"chemin relatif à la racine du dépôt","quotes":[{"quote":"extrait exact"}]}.
Au plus 3 citations par document, pas plus d'une phrase par citation. Extrait sur deux pages : "page":"1-2" et [[PAGE_BREAK]] dans quote entre la fin de la page 1 et le début de la page 2. Tableur : sheet et cell au lieu de page.
Dans un .docx : aucun [n] dans le document mais une note de bas de page « source, localisation : "extrait exact" » ; même bloc <CITATIONS> en fin de réponse, ref = numéro de la note.
Programme du dossier : conserve CITATIONS en fin de tour. Pour formaliser ou réviser le raisonnement du dossier, ajoute dans ce même tableau un seul objet {"kind":"program","version":1,"nodes":[...],"scenarios":[...],"tests":[...]}. Cet objet n'est pas une citation, il ne porte pas de ref. Ne crée pas de programme pour une simple conversation ou du code applicatif.
Chaque nœud : {"id":"F_montant","kind":"fact","label":"Montant en centimes","state":"asserted","value":1200000,"citations":[1]}. Identifiants stables (lettre puis lettres, chiffres, _ ou -), jamais de nom réel dans un identifiant. state=asserted signifie extrait proposé, pas vérité établie. disputed ou unknown reste indéterminé. Un fait renseigné sans citation est bloqué ; une citation recalée impose un réexamen. Les citations sont celles DU TOUR ; n'invente jamais leur statut de vérification. Un nœud existant conserve ses sources si citations est omis. Un nœud réémis remplace sa définition complète ; remove:["id"] le retire explicitement.
Nœud dérivé : {"id":"C_solde","kind":"calculation","label":"Solde documentaire en centimes","expression":{"op":"subtract","args":[{"ref":"F_montant"},{"ref":"F_versement"}]}}. kind = rule, calculation ou conclusion. Expressions : scalaire JSON (null=inconnu), {"ref":"id"}, {"op":"and|or|not|equal|greater|atLeast|less|atMost|add|subtract|multiply|divide|if","args":[...]}. if prend condition,bool-vrai,bool-faux (branches de tout type). Les opérateurs numériques exigent des nombres ; montants en centimes entiers, pas d'arrondi implicite. Aucune exécution de code arbitraire. Règles et qualifications sont des modèles proposés avec rationale explicite, pas du droit certifié ; rattache leurs sources juridiques via citations. Ne réinjecte pas une déduction comme un fait extrait.
Scénario : {"id":"versement_retenu","label":"Hypothèse versement","assumptions":{"F_versement":400000}}. Les hypothèses ne remplacent que des faits, sont toujours signalées et ne modifient pas le dossier de base. Ne transforme jamais absence d'information en faux ou zéro.
Test : {"id":"T_solde","label":"Solde sous cette hypothèse","target":"C_solde","scenario":"versement_retenu","expected":{"status":"known","value":800000}}. Sans scenario : base. status = known, unknown, blocked ou error. Les tests écrits par l'IA vérifient son modèle, pas la vérité juridique ; explique l'origine des attentes. Maximum 200 nœuds, 16 scénarios, 200 tests.
La compilation se produit APRÈS la réponse. Ne prétends pas avoir exécuté le programme que tu viens de proposer. Au tour suivant récupère les résultats par sql : SELECT * FROM pm_reasoning_results WHERE project_id=dossier(); et l'état complet : SELECT snapshot_json FROM pm_reasoning_programs WHERE project_id=dossier();. Tables gérées par le serveur, à lire uniquement : toutes les modifications passent par l'objet program de CITATIONS. Les résultats indiquent dépendances, inconnues, hypothèses et erreurs. Utilise-les pour chercher des contre-exemples, identifier la pièce décisive et réviser l'acte. Le programme n'est complet que pour les questions effectivement formalisées.
${CLOSE}`;

export function withCitationInstructions(command: string, programContext = '') {
  return `${command}\n\n${programContext ? INSTRUCTIONS.replace(CLOSE, `\n${programContext}\n${CLOSE}`) : INSTRUCTIONS}`;
}

export function withoutCitationInstructions(command: string) {
  if (!command.endsWith(CLOSE)) return command;
  const start = command.lastIndexOf(`\n\n${OPEN}\n`);
  return start < 0 ? command : command.slice(0, start);
}
