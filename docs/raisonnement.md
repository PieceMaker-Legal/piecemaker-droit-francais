# Raisonnement du dossier

L’agent construit la théorie juridique du dossier pas à pas avec la commande `pm raisonnement` de la skill `piecemaker` (`server/piecemaker/vendor/skills/Skill-PieceMaker/`, même route locale que l’ancien outil MCP). Il n’écrit pas de code : chaque commande ajoute un élément, le serveur génère le programme Catala, l’exécute et renvoie un état court avec ce qui reste à faire. Le volet droit **Raisonnement** montre le graphe, le détail de chaque élément et le test. L’avocat valide ou écarte chaque élément : un élément décidé est verrouillé et l’agent ne peut plus le modifier.

L’instruction de chat ajoute une seule ligne : pour une analyse appliquée au dossier, utiliser `pm raisonnement` (`pm raisonnement etat` pour reprendre). Aucun code n’est injecté dans le prompt.

## Commandes

| Commande | Champs | Effet |
|---|---|---|
| `etat` | `question` facultatif | Réponse calculée, conditions, faits, « À faire », date du dernier test. |
| `question` | `texte`, `objectif` (`oui`/`non`), `date` (nom du fait date de référence), `question` pour modifier | Crée `Q1`, `Q2`… |
| `condition` | `question`, `nom`, `libelle`, `regle`, `source`, `extrait`, `role` (`condition`, `fondement`, `moyen_adverse`), `a_la_date` | `source` = `LEGIARTI…`, `JURITEXT…` (lus sur Légifrance par le serveur) ou chemin d’une note de doctrine ; l’extrait est recherché dans le texte, la période de vigueur et l’historique judiciaire sont relevés. Un nom inconnu dans `regle` devient un fait booléen à prouver. |
| `fait` | `question`, `nom`, `type`, `valeur`, `piece`, `extrait`, `force`, `appreciation` | L’extrait est recherché dans la pièce (Markdown converti) ; introuvable, le fait reste non établi. |
| `retirer` | `question`, `nom` facultatif | Retire un élément ou toute la question. |
| `tester` | — | Exécute le test (ci-dessous) et renvoie la liste des alertes. |

`regle` est une expression Catala : `et`, `ou`, `non`, `= != < <= > >=`, `+ - * /`, `vrai`, `faux`, `|AAAA-MM-JJ|`, `2 mois`. Une condition `fondement` mène à la réponse (`étiquette base règle reponse …`), un `moyen_adverse` l’écarte (`exception base … conséquence non rempli`).

Le modèle (questions, conditions, faits) est stocké dans `pm_reasoning_models` ; le Catala est régénéré à chaque commande, puis les verrous de l’avocat sont réappliqués.

## Test

Le test est l’exécution statique de la théorie avec tout ce qui est disponible dans le dossier (`POST /api/piecemaker/reasoning/test`, bouton « Lancer le test » ou commande `tester`) :

- **Programme** : réponse calculée et objectif, vigueur de chaque article à la date de référence, conditions sans fondement, faits à prouver.
- **Jurisprudence** : chaque décision citée est relue sur Légifrance ; une décision remise en cause par une décision supérieure ou un recours à examiner est signalé.
- **Pièces** : chaque extrait cité est recherché à nouveau dans sa pièce.
- **Personnes morales de la base SQL** (`piecemaker_nodes` de type `company`) : recherche au Registre Public par SIREN (sinon par nom) ; introuvable, radiée ou cessée est signalé ; avec un SIREN, les alertes BODACC (procédure collective, radiation) sont relevées.

La route répond en NDJSON : une ligne `{entry}` par étape du journal (`ReasoningLogEntry` : vérification en cours puis son résultat, sous la même clé ; puis le raisonnement en langage clair : la question, en droit (fondement de chaque règle, vigueur), en fait (valeur et pièces de chaque fait), conclusion (chaque condition, ce qui reste à prouver, réponse) ; aucun code n’est affiché), et une dernière ligne `{snapshot}`. L’onglet Tests du volet affiche ce journal à mesure qu’il arrive. Le rapport (`ReasoningTestReport`, alertes d’abord, avec le journal final) est conservé dans l’instantané jusqu’à la commande suivante. Une vérification impossible (réseau, Légifrance) est une alerte, jamais un succès.

Sous-ensemble pris en charge (`server/modules/piecemaker-reasoning/catala.ts`) : déclarations `entrée`/`interne`/`résultat` (types `booléen`, `date`, `entier`, `décimal`, `argent`, `durée`, `condition`) et sous-champs ; `règle … sous condition … conséquence [non] rempli` ; `définition … [sous condition … conséquence] égal à …` ; `étiquette`/`exception` ; `et`, `ou`, `non`, `si … alors … sinon`, comparaisons, `+ - * /` ; `|AAAA-MM-JJ|`, `5 an`, `2 mois`, `10 jour` (mois et années au même quantième, dernier jour du mois à défaut) ; attributs `#[clé = valeur]` . Le compilateur Catala n’est pas utilisé (OCaml seulement, pas d’analyseur Node).

## Vérifications statiques

- **Question** : valable si elle énonce `question`, un `résultat`, une `date_de_référence` (entrée de type date) et au moins une condition fondée, avec au moins un article cité.
- **Vigueur** : pour chaque article cité par une règle, la date de référence (ou `#[à_la_date = …]`) doit tomber dans la période `Validité` lue dans le résultat `consulter_article` (début inclus, fin exclusive). Hors période, la règle ne s’applique pas ; période inconnue, la condition est bloquée.
- **Fondement d’une condition** : chaque règle cite au moins une source dont l’extrait est retrouvé. Article = loi, décision = jurisprudence, document cité par une règle = doctrine. La force retenue est la plus haute (loi > jurisprudence > doctrine) ; une condition fondée sur la seule doctrine est signalée. Ce classement n’est pas annoncé au modèle.
- **Jurisprudence** : `consulter_decision` ajoute un contrôle `Historique: …` calculé par le MCP Légifrance (`controle_historique`, fil procédural de `Historique_Judiciaire`) : un recours qui a cassé, annulé ou infirmé la décision la rend « remise en cause » et elle ne fonde plus rien ; un recours sans solution lisible ou un relevé tronqué la laisse « à examiner ». Les décisions postérieures qui la citent sont listées sans interprétation.
- **Faits** : une entrée est établie par une définition dans `Dossier` dont la valeur est une constante du bon type, prouvée par au moins une pièce (document cité par le champ Dossier) dont l’extrait est retrouvé, avec une force probante (`acte_authentique`, `acte_sous_seing_privé`, `commencement_de_preuve`, `indice`, `sans_valeur`). Sinon elle est « non établie » et vaut inconnu ; sans pièce : « pièce à rechercher ».

L’évaluation est à trois valeurs (vrai, faux, inconnu). Une condition est remplie, non remplie, indéterminée ou bloquée (fondement manquant, période inconnue, écartée par l’avocat, erreur de type, conflit d’exceptions). Une question est bloquée si une condition dont elle dépend l’est.

## Objectif et argumentaire

`#[objectif = rempli]` (ou `non rempli`, en défense) déclare le résultat recherché pour le client. Chaque règle qui définit le résultat est une **voie** : celles dont la conséquence va dans le sens de l’objectif sont les moyens du client, les autres (en pratique des `exception` de conséquence contraire) les moyens adverses. Pour chaque voie, le serveur donne son état (ouverte, à établir, fermée, bloquée), son fondement le plus faible, les faits encore non établis qui l’alimentent et ses points faibles (doctrine seule, historique à examiner, pièce valant simple indice ou commencement de preuve). Les moyens du client sont classés (ouverts d’abord, puis par fondement, puis par nombre de faits à prouver) : le premier est le principal, les suivants subsidiaires. L’objectif est « atteint », « à établir » ou « hors d’atteinte » selon la valeur du résultat.

Charge de la preuve (art. 1353 C. civ.) : un fait qui alimente un moyen du client est à sa charge ; un fait qui n’alimente qu’un moyen adverse est à la charge de l’adversaire. Aucun calcul de combinaisons : l’analyse lit seulement les dépendances du programme.

## Décisions de l’avocat

Chaque condition et chaque fait se valide, s’écarte ou se modifie dans le volet (`POST /api/piecemaker/reasoning/review` et `/appreciation`). Une modification d’un fait (valeur, force probante, appréciation) est enregistrée avec l’auteur `avocat` et valide le fait. Le texte de l’élément est figé (`locked_json`) : toute commande de l’agent qui le vise est refusée. « Annuler la décision » rend l’élément à l’agent.

## Volet

- **Graphe** : sources du droit, conditions et réponse, faits. Un clic sur un nœud éclaire sa branche.
- **Détail** : la réponse en langage courant, ce qui reste à prouver, puis le détail du nœud choisi avec ses boutons de validation.
- **Tests** : bouton « Lancer le test » et journal animé en quatre parties (La question, En droit, En fait, Conclusion) ; un clic sur un fait ouvre sa fiche pour le renseigner ; le nombre d’alertes du dernier test s’affiche sur l’onglet. Style repris du plugin piecemaker-dossier.

## SQL

Tables en lecture seule pour l’outil SQL :

```sql
SELECT code, snapshot_json FROM pm_reasoning_programs WHERE project_id=dossier();
SELECT item_id, kind, status, value_json, force, appreciation, author FROM pm_reasoning_items WHERE project_id=dossier();
```

Les tables des versions précédentes (`pm_reasoning_results`, `_nodes`, `_relations`, `_links`, `_theories`, `_tests`, `_turns`) sont supprimées au démarrage.

## Fichiers

- `shared/piecemaker-reasoning.ts` : contrat partagé.
- `server/modules/piecemaker-reasoning/` : commandes et génération du Catala (`commands.ts`), analyseur, évaluation, persistance, verrous, test, routes ; tests dans `tests/raisonnement.test.ts` (connecteurs fictifs).
- `server/piecemaker/reasoning-connectors.ts` : Légifrance (`consulter_article`, `consulter_decision`), pièces, Registre Public, BODACC.
- `server/piecemaker/vendor/mcp/piecemaker/server.mjs` : outil `raisonnement`, relayé à `POST /api/piecemaker/local/reasoning` (boucle locale seulement).
- `server/piecemaker/vendor/mcp/legifrance/tools/decision_history.py` : `controle_historique`, appelé par `consulter_decision`.
- `plugins/piecemaker-raisonnement/` : volet.

## Legal Code (beta)

Bouton « Legal Code » sous « Nouvelle session » (`src/piecemaker/legal-code/`) : ouvre une session vierge avec, sous « Choisissez votre assistant IA », un encart qui explique le fonctionnement. Rien n’apparaît dans le composeur : le premier message porte l’option `legalCode`, et `installLegalCodeHarness` (`server/piecemaker/legal-code/`) y ajoute `instructions.md` entre balises `<LEGAL_CODE_INSTRUCTION>`, retirées de l’écho et de l’historique. Un clic sur « Nouvelle session » ou l’ouverture d’une autre session annule le mode. Le reste de la session est une session classique.
