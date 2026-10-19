---
name: raisonnement-verifie
description: Cadre du raisonnement juridique vérifié de PieceMaker (fichier .piecemaker/raisonnement.js, vérificateur, contrôles, volet Raisonnement). Use whenever modifying, reviewing or testing server/modules/piecemaker-reasoning, the agent instruction server/piecemaker/legal-code/instructions.md, or the piecemaker-raisonnement plugin.
---

# Raisonnement vérifié

L'agent transcrit sa réponse juridique dans `.piecemaker/raisonnement.js`, un objet JavaScript sans fonctions que le serveur lit sans l'exécuter. `pm raisonnement verifier` le vérifie, le teste, le réécrit et renvoie ses erreurs et manques. Le volet Raisonnement montre à l'avocat le graphe, le détail et les alertes.

## Principes (décidés, à ne pas défaire)

- **Une seule source d'instructions** : `server/piecemaker/legal-code/instructions.md`. Elle ne contient que des règles d'écriture génériques et la commande. La skill `piecemaker`, l'outil MCP et le harness des citations ne la répètent pas.
- **C'est le vérificateur qui conduit l'agent** vers un raisonnement complet et sourcé, par ses manques. Les contrôles, la qualification et leurs conséquences ne sont jamais expliqués dans l'instruction.
- **Erreur = défaut d'écriture** (syntaxe, citation introuvable, terme non défini, essai non conforme…). **Manque = ce qui reste à établir** ; l'avocat peut l'écarter.
- **Générique** : aucune règle ne dépend d'un domaine ou d'un vocabulaire (« annexe », « contrat »…). L'agent déclare, le vérificateur vérifie.
- **Souplesse** : un manque désigne où se prononcer, jamais quoi répondre. Ne pas pousser le modèle à combler pour combler.
- Le vérificateur ne cite jamais lui-même de texte de référence : il signale ce qui doit être entré.
- Données réelles interdites dans le dépôt (voir `AGENTS.md`) : exemples et tests fictifs.

## Le fichier

- `qualification` : `'drafting'` (faits à prévoir), `'contentieux'` ou `'consultation'` (faits à prouver ; la consultation suit les règles du contentieux). Non affichée dans le volet.
- `questions: [{ question, reponse, validite?, prescription? }]` ; `reponse` désigne un terme, ou une valeur quand la réponse est un montant (statut + `montant_calcule`).
- Un terme par clé : `{ si: [...], sauf: [...] }` ; `l_une` = une condition suffit. Une condition sans clé propre est un fait (`preuve`, `contredit: [{ piece, citation }]`).
- `selon: [{ source, citation, vigueur: { debut, fin, au }, applicabilite, validite, renvoi, contredit }]` : identifiant officiel (LEGIARTI, JURITEXT, CETATEXT…) ou chemin de pièce pour une clause ; citation exacte. `renvoi: [{ piece, citation? }]` = ce à quoi la stipulation renvoie (déclaré par l'agent, quel que soit le mot employé) ; `contredit` = stipulation contraire.
- Délai : `delai: { de, a, au_plus | au_moins: { jours | jours_ouvres | mois | ans: n } }` + `decompte`. Montant : `montant: { valeur, plus_de | au_moins | moins_de | au_plus: nom }`. Données dans `valeurs: { nom: { valeur, preuve | selon, formule? } }`, `valeur: null` si le dossier ne la fixe pas. `preuve` = pièce (donnée stipulée ou constatée) ; `selon` = texte qui fixe la valeur (taux, seuil, barème), vérifié comme toute source (citation, vigueur à la date `au`, applicabilité) ; une pièce en `selon` est une erreur.
- `formule` calcule un montant (sans valeur prouvée, la formule le donne ; avec, les deux doivent concorder) : `somme | difference | produit | quotient | minimum | maximum: [termes]`, `arrondi: [montant, décimales]`, `bareme: { assiette, tranches: [{ jusqu_a, taux }, …, { taux }] }` (progressif), `{ si: terme, alors, sinon }` (montant selon un régime ; terme à trois valeurs). Nombres écrits dans une formule sans `preuve` ni `selon` = manque.
- `essais: [{ nom, faits, attendu }]` : un fait absent reprend sa valeur établie ; `attendu` porte sur un terme (vrai/faux) ou un montant (nombre).
- Variables : une valeur ouverte (`null`) n'est signalée que si une réponse en dépend (fait décisif calculé, ou opérande d'un montant-réponse). En drafting le manque se lève en fixant la valeur ou par des essais qui la supposent : pour un terme, des essais conformes donnant des résultats différents (la bascule) ; pour un montant, un essai conforme qui donne le montant attendu. Aucune détection textuelle des blancs.
- Simulation (volet, onglet Détail de la question) : l'avocat modifie les valeurs, `POST /reasoning/simulate` rejoue le raisonnement hors ligne (sources en cache du dernier test), rien n'est écrit.

## Contrôles (sous-raisonnements)

Termes ordinaires désignés par un emplacement, nommés avec son préfixe (vérifié dans les deux sens). L'élément conditionné ne compte que si le contrôle est acquis.

| Emplacement | Sur | Préfixe | Réclamé |
|---|---|---|---|
| `applicabilite` | source texte | `applicabilité_` | tout texte, sauf cité dans un arbre d'applicabilité |
| `validite` | source clause | `validité_` | toute clause, sauf citée dans un arbre de validité ou d'applicabilité ; distinct de la validité de l'acte ; doit citer un texte |
| `decompte` | délai | `décompte_` | tout délai |
| `validite` | question | `validité_` | drafting (sauf question qui porte sur la validité) |
| `prescription` | question | `prescription_` | contentieux, consultation |

Exemptions = garde-fous contre la régression à l'infini (validité → texte → applicabilité → clause sans nouvelle validité).

## Manques par mode

- **Tous** : non qualifié ; valeur ouverte dont dépend une réponse ; renvoi vers un élément absent du dossier ou un passage introuvable ; stipulation contredite (la source ne compte plus : à trancher) ; montant stipulé différent de sa formule ; texte sans `vigueur`, sans `vigueur.au` ou date non prouvée ; version non en vigueur ; clause qui renvoie à un article sans ce texte ; donnée de calcul non déclarée ; valeur non nulle sans preuve ; seuil en dur ; source non vérifiable ; terme inutile.
- **Drafting** : faits = hypothèses, pas de manque de preuve ; chaque question a un essai ; une valeur ouverte décisive se lève par des essais ; stipulations contradictoires = à harmoniser.
- **Contentieux / consultation** : fait décisif sans pièce ; prescription.

## Sortie de `verifier`

- À l'agent : uniquement erreurs puis manques, numérotés, chacun avec son emplacement (`terme › si[0] › selon[1] › validite`), sa ligne, le contenu de la ligne (ou où l'ajouter) et la consigne. Pas de réponses ni de statuts.
- Le fichier est réécrit dans l'ordre canonique (qualification, questions, termes en descendant, contrôles regroupés, valeurs, essais) et imprimé pour grep : un terme par en-tête à deux espaces, une source ou preuve par ligne. L'agent relit avec grep/sed.
- Au volet : l'objet annoté complet (statuts, décisifs, `bilan.controles`, vigueur, pièces). L'avocat écarte des alertes et note la fiabilité des pièces (tables `pm_reasoning_dismissed`, `pm_reasoning_reliability`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `server/modules/piecemaker-reasoning/format.ts` | lecture acorn, validation, contrôles, ordre canonique, impression |
| `server/modules/piecemaker-reasoning/engine.ts` | logique à trois valeurs, faits décisifs, délais, essais |
| `server/modules/piecemaker-reasoning/program.ts` | vérification, manques, sortie, service, exemple fictif |
| `server/piecemaker/reasoning-connectors.ts` | Légifrance, pièces, registre, BODACC |
| `server/piecemaker/legal-code/instructions.md` | instruction de l'agent (seule source) |
| `plugins/piecemaker-raisonnement/src/client.ts` | volet |

## Tester

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/piecemaker-reasoning/tests/*.test.ts` (Node 24 via nvm).
- Test de bout en bout : un agent léger (Haiku) ne reçoit que `instructions.md` et un dossier anonymisé, boucle sur `verifier` jusqu'à zéro erreur ; on inspecte le fichier et les manques restants. Ne jamais lui expliquer les contrôles.

## En suspens (proposé, non validé)

Relecture du document lui-même (définitions, désignations, chiffres en lettres, numérotation, blancs à remplir) : outil séparé, non décidé. Options de rédaction (clause présente ou non) : seulement par un fait vrai/faux sans source. Connecteur BOFiP. Contrôles propres au contentieux (recevabilité, compétence, délais de procédure).
