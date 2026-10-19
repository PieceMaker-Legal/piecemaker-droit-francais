---
name: raisonnement-verifie
description: Cadre du raisonnement juridique vérifié de PieceMaker (fichier .piecemaker/raisonnement.js, vérificateur, contrôles, volet Raisonnement). Use whenever modifying, reviewing or testing server/modules/piecemaker-reasoning, the agent instruction server/piecemaker/legal-code/instructions.md, or the piecemaker-raisonnement plugin.
---

# Raisonnement vérifié

L'agent transcrit sa réponse juridique dans `.piecemaker/raisonnement.js`, un objet JavaScript sans fonctions que le serveur lit sans l'exécuter. `pm raisonnement verifier` le vérifie, le teste, le réécrit et renvoie ses erreurs et manques. Le volet Raisonnement montre à l'avocat le graphe, le détail et les alertes.

## Principes (décidés, à ne pas défaire)

- **Une seule source d'instructions** : `server/piecemaker/legal-code/instructions.md`. Elle ne contient que des règles d'écriture génériques et la commande. La skill `piecemaker`, l'outil MCP et le harness des citations ne la répètent pas.
- **C'est le vérificateur qui conduit l'agent** vers un raisonnement complet et sourcé, par ses manques. Les contrôles, la qualification et leurs conséquences ne sont jamais expliqués dans l'instruction.
- **Erreur = défaut d'écriture** (syntaxe, citation introuvable, terme non défini, hypothèse non conforme…). **Manque = ce qui reste à établir** ; l'avocat peut l'écarter.
- **Générique** : aucune règle ne dépend d'un domaine ou d'un vocabulaire (« annexe », « contrat »…). L'agent déclare, le vérificateur vérifie.
- **Souplesse** : un manque désigne où se prononcer, jamais quoi répondre. Ne pas pousser le modèle à combler pour combler.
- **Le raisonnement est orienté par l'objectif** : comme un avocat, l'agent sert l'objectif du client et discute l'interprétation des textes pour l'atteindre. Le vérificateur désigne ce qui y fait obstacle, jamais il ne dispense de preuve ou de citation exacte.
- **Un manque n'est réclamé que s'il est systématique** : il doit se poser pour tout élément ou tout objectif du mode, quel que soit le sujet (la vigueur de tout texte cité ; la prescription en contentieux, où toute action exerce un droit). Ce qui ne se pose que selon le contenu de l'objectif n'est jamais réclamé, puisque le vérificateur ne lit pas ce contenu (la prescription en consultation : « puis-je encore agir ? » oui, « combien d'impôt sur la cession à venir ? » non) : l'emplacement reste disponible et contrôlé, l'agent l'ajoute s'il le juge utile. Avant d'ajouter un manque, vérifier cette règle.
- Le vérificateur ne cite jamais lui-même de texte de référence : il signale ce qui doit être entré.
- Données réelles interdites dans le dépôt (voir `AGENTS.md`) : exemples et tests fictifs.

## Le fichier

- `qualification` : `'drafting'` (faits à prévoir), `'contentieux'` ou `'consultation'` (faits à prouver ; la consultation suit les règles du contentieux, sauf la prescription). Non affichée dans le volet.
- `objectifs: [{ objectif, obtenir | écarter | réduire | augmenter: nom, validite?, prescription? }]` : le but du client et, par un seul verbe, ce qu'il vise : `obtenir`/`écarter` un terme, `réduire`/`augmenter` un montant de `valeurs` (statut + `montant_calcule`). Verbe absent, en double ou inadapté au type = erreur ; les anciennes clés `questions`, `question`, `reponse` = erreurs qui disent quoi renommer. Annotations : `atteint` (vrai/faux, en suspens), `obstacles`.
- Un terme par clé : `{ si: [...], sauf: [...] }` ; `l_une` = une condition suffit. Une condition sans clé propre est un fait (`preuve`, `contredit: [{ piece, citation }]`).
- `selon: [{ source, citation, vigueur: { debut, fin, au }, applicabilite, validite, renvoi, contredit }]` : identifiant officiel (LEGIARTI, JURITEXT, CETATEXT…) ou chemin de pièce pour une clause ; citation exacte. `renvoi: [{ piece, citation? }]` = ce à quoi la stipulation renvoie (déclaré par l'agent, quel que soit le mot employé) ; `contredit` = stipulation contraire.
- Délai : `delai: { de, a, au_plus | au_moins: { jours | jours_ouvres | mois | ans: n } }` + `decompte`. Montant : `montant: { valeur, plus_de | au_moins | moins_de | au_plus: nom }`. Données dans `valeurs: { nom: { valeur, preuve | selon, formule? } }`, `valeur: null` si le dossier ne la fixe pas. `preuve` = pièce (donnée stipulée ou constatée) ; `selon` = texte qui fixe la valeur (taux, seuil, barème), vérifié comme toute source (citation, vigueur à la date `au`, applicabilité) ; une pièce en `selon` est une erreur.
- `formule` calcule un montant (sans valeur prouvée, la formule le donne ; avec, les deux doivent concorder) : `somme | difference | produit | quotient | minimum | maximum: [termes]`, `arrondi: [montant, décimales]`, `bareme: { assiette, tranches: [{ jusqu_a, taux }, …, { taux }] }` (progressif), `{ si: terme, alors, sinon }` (montant selon un régime ; terme à trois valeurs). Nombres écrits dans une formule sans `preuve` ni `selon` = manque.
- `hypotheses: [{ nom, faits, attendu }]` : cas supposés que le moteur rejoue (l'ancienne clé `essais` est une erreur qui demande de la renommer) ; un fait absent reprend sa valeur établie ; `attendu` porte sur un terme (vrai/faux) ou un montant (nombre). Une hypothèse non conforme est une erreur : le raisonnement ne dit pas ce que l'agent conclut.
- Variables : une valeur ouverte (`null`) n'est signalée que si une réponse en dépend (fait décisif calculé, ou opérande d'un montant-réponse). En drafting et en consultation, le manque se lève en fixant la valeur ou par des hypothèses qui la supposent : pour un terme, des hypothèses conformes donnant des résultats différents (la bascule) ; pour un montant, une hypothèse conforme qui donne le montant attendu. En contentieux, seule la preuve le lève. Un fait vrai/faux décisif sans pièce n'est jamais levé par une hypothèse hors drafting. Aucune détection textuelle des blancs.
- Simulation (volet, onglet Détail de l'objectif) : l'avocat modifie les valeurs, `POST /reasoning/simulate` rejoue le raisonnement hors ligne (sources en cache du dernier test), rien n'est écrit.

## Contrôles (sous-raisonnements)

Termes ordinaires désignés par un emplacement, nommés avec son préfixe (vérifié dans les deux sens). L'élément conditionné ne compte que si le contrôle est acquis.

| Emplacement | Sur | Préfixe | Réclamé |
|---|---|---|---|
| `applicabilite` | source texte | `applicabilité_` | tout texte, sauf cité dans un arbre d'applicabilité |
| `validite` | source clause | `validité_` | toute clause, sauf citée dans un arbre de validité ou d'applicabilité ; distinct de la validité de l'acte ; doit citer un texte |
| `decompte` | délai | `décompte_` | tout délai |
| `validite` | objectif | `validité_` | drafting (sauf objectif qui porte sur la validité) |
| `prescription` | objectif | `prescription_` | contentieux seulement ; ailleurs facultatif |

Exemptions = garde-fous contre la régression à l'infini (validité → texte → applicabilité → clause sans nouvelle validité).

## Manques par mode

- **Tous** : non qualifié ; valeur ouverte dont dépend une réponse ; renvoi vers un élément absent du dossier ou un passage introuvable ; stipulation contredite (la source ne compte plus : à trancher) ; montant stipulé différent de sa formule ; texte sans `vigueur`, sans `vigueur.au` ou date non prouvée ; version non en vigueur ; clause qui renvoie à un article sans ce texte ; donnée de calcul non déclarée ; valeur non nulle sans preuve ; seuil en dur ; source non vérifiable ; terme inutile ; **obstacle à un objectif** : fait établi ou source dont la seule bascule rapproche l'objectif (pour un montant, via les conditions `si` de ses formules), à son emplacement, avec les objectifs que cette bascule éloignerait (« en tension : à arbitrer ») ; objectif contraire sans obstacle unique (chercher un autre fondement, une exception).
- **Drafting** : faits supposés, pas de manque de preuve ; chaque objectif a une hypothèse ; une valeur ouverte décisive se lève par des hypothèses ; stipulations contradictoires = à harmoniser.
- **Contentieux / consultation** : fait décisif sans pièce ; valeur ouverte décisive (en consultation, levée aussi par des hypothèses).
- **Contentieux** : prescription de chaque objectif.

## Sortie de `verifier`

- À l'agent : uniquement erreurs puis manques, numérotés, chacun avec son emplacement (`terme › si[0] › selon[1] › validite`), sa ligne, le contenu de la ligne (ou où l'ajouter) et la consigne. Pas de réponses ni de statuts.
- Le fichier est réécrit dans l'ordre canonique (qualification, objectifs, termes en descendant, contrôles regroupés, valeurs, hypothèses) et imprimé pour grep : un terme par en-tête à deux espaces, une source ou preuve par ligne. L'agent relit avec grep/sed.
- Au volet : l'objet annoté complet (statuts, décisifs, `bilan.controles`, vigueur, pièces). L'avocat écarte des alertes et note la fiabilité des pièces (tables `pm_reasoning_dismissed`, `pm_reasoning_reliability`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `server/modules/piecemaker-reasoning/format.ts` | lecture acorn, validation, contrôles, ordre canonique, impression |
| `server/modules/piecemaker-reasoning/engine.ts` | logique à trois valeurs, faits décisifs, délais, hypothèses |
| `server/modules/piecemaker-reasoning/program.ts` | vérification, manques, sortie, service, exemple fictif |
| `server/piecemaker/reasoning-connectors.ts` | Légifrance, pièces, registre, BODACC |
| `server/piecemaker/legal-code/instructions.md` | instruction de l'agent (seule source) |
| `plugins/piecemaker-raisonnement/src/client.ts` | volet |

## Tester

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/piecemaker-reasoning/tests/*.test.ts` (Node 24 via nvm).
- Test de bout en bout : un agent léger (Haiku) ne reçoit que `instructions.md` et un dossier anonymisé, boucle sur `verifier` jusqu'à zéro erreur ; on inspecte le fichier et les manques restants. Ne jamais lui expliquer les contrôles.

## En suspens (proposé, non validé)

Relecture du document lui-même (définitions, désignations, chiffres en lettres, numérotation, blancs à remplir) : outil séparé, non décidé. Options de rédaction (clause présente ou non) : seulement par un fait vrai/faux sans source. Verbe neutre `établir` (sans manque d'obstacle) : à ajouter directement si un test montre qu'un agent s'invente un intérêt sur une demande purement informative. Objectifs sur une date (avancer, retarder) et sur une durée : non couverts tant qu'un cas réel ne le demande pas (la durée d'un délai n'est pas encore une valeur nommée). Connecteur BOFiP. Contrôles propres au contentieux (recevabilité, compétence, délais de procédure).
