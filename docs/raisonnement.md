# Raisonnement du dossier

Le volet droit **Raisonnement** montre, pour chaque question de droit, les conditions posées par le droit à gauche et les faits prouvés par pièces à droite. Derrière le schéma, le modèle écrit un programme dans un sous-ensemble de Catala (syntaxe française). Le serveur l’analyse, le vérifie et l’exécute en fin de tour. L’avocat valide ou écarte chaque élément : un élément décidé est verrouillé et s’impose au modèle.

Les citations ne servent plus qu’au raisonnement : une analyse n’affiche plus de liste « Sources » dans le chat, seulement une ligne de bilan. Le bloc `<CITATIONS>` sans `<RAISONNEMENT>` (notes de bas de page d’un `.docx`, consigne dans la skill `redaction-juridique`) garde sa liste vérifiée.

## Format de fin de tour

```
<CITATIONS>[{"ref":1,"kind":"article","article_id":"LEGIARTI…","quotes":[{"quote":"…"}]}, …]</CITATIONS>
<RAISONNEMENT>
#[question = "…"]
#[date_de_référence = date_acte]
déclaration champ d'application Q:
  entrée date_acte contenu date
  entrée cotee contenu booléen
  interne personne condition
  résultat effet condition
champ d'application Q:
  #[libellé = "…"] #[selon = 1]
  règle personne sous condition cotee conséquence rempli
  #[selon = 1]
  règle effet sous condition personne conséquence rempli
déclaration champ d'application Dossier:
  q champ Q
champ d'application Dossier:
  #[selon = 2] #[force = acte_sous_seing_privé] #[appréciation = "…"]
  définition q.cotee égal à vrai
</RAISONNEMENT>
```

Les deux blocs sont masqués du chat. `#[selon = n]` renvoie au `ref` du tour ; le serveur le remplace par l’identifiant stable de la source (`s` + 8 hexadécimaux), réutilisable aux tours suivants. Le code est réimprimé sous forme canonique et réinjecté au tour suivant, avec les sources enregistrées, les éléments verrouillés et la liste « À traiter ».

Sous-ensemble pris en charge (`server/modules/piecemaker-reasoning/catala.ts`) : déclarations `entrée`/`interne`/`résultat` (types `booléen`, `date`, `entier`, `décimal`, `argent`, `durée`, `condition`) et sous-champs ; `règle … sous condition … conséquence [non] rempli` ; `définition … [sous condition … conséquence] égal à …` ; `étiquette`/`exception` ; `et`, `ou`, `non`, `si … alors … sinon`, comparaisons, `+ - * /` ; `|AAAA-MM-JJ|`, `5 an`, `2 mois`, `10 jour` (mois et années au même quantième, dernier jour du mois à défaut) ; attributs `#[clé = valeur]` ; blocs ` ```catala ` d’un texte littéraire. Le compilateur Catala n’est pas utilisé (OCaml seulement, pas d’analyseur Node).

## Vérifications statiques

- **Question** : valable si elle énonce `question`, un `résultat`, une `date_de_référence` (entrée de type date) et au moins une condition fondée, avec au moins un article cité.
- **Vigueur** : pour chaque article cité par une règle, la date de référence (ou `#[à_la_date = …]`) doit tomber dans la période `Validité` lue dans le résultat `consulter_article` (début inclus, fin exclusive). Hors période, la règle ne s’applique pas ; période inconnue, la condition est bloquée.
- **Fondement d’une condition** : chaque règle cite au moins une source dont l’extrait est retrouvé. Article = loi, décision = jurisprudence, document cité par une règle = doctrine. La force retenue est la plus haute (loi > jurisprudence > doctrine) ; une condition fondée sur la seule doctrine est signalée. Ce classement n’est pas annoncé au modèle.
- **Jurisprudence** : `consulter_decision` ajoute un contrôle `Historique: …` calculé par le MCP Légifrance (`controle_historique`, fil procédural de `Historique_Judiciaire`) : un recours qui a cassé, annulé ou infirmé la décision la rend « remise en cause » et elle ne fonde plus rien ; un recours sans solution lisible ou un relevé tronqué la laisse « à examiner ». Les décisions postérieures qui la citent sont listées sans interprétation.
- **Faits** : une entrée est établie par une définition dans `Dossier` dont la valeur est une constante du bon type, prouvée par au moins une pièce (document cité par le champ Dossier) dont l’extrait est retrouvé, avec une force probante (`acte_authentique`, `acte_sous_seing_privé`, `commencement_de_preuve`, `indice`, `sans_valeur`). Sinon elle est « non établie » et vaut inconnu ; sans pièce : « pièce à rechercher ».

L’évaluation est à trois valeurs (vrai, faux, inconnu). Une condition est remplie, non remplie, indéterminée ou bloquée (fondement manquant, période inconnue, écartée par l’avocat, erreur de type, conflit d’exceptions). Une question est bloquée si une condition dont elle dépend l’est.

## Décisions de l’avocat

Chaque condition et chaque fait se valide, s’écarte ou se modifie dans le volet (`POST /api/piecemaker/reasoning/review` et `/appreciation`). Une modification d’un fait (valeur, force probante, appréciation) est enregistrée avec l’auteur `avocat` et valide le fait. Le texte de l’élément est figé (`locked_json`) : au tour suivant, toute version différente du modèle est remplacée et signalée. « Annuler la décision » rend l’élément au modèle.

## SQL

Tables en lecture seule pour l’outil SQL :

```sql
SELECT code, snapshot_json FROM pm_reasoning_programs WHERE project_id=dossier();
SELECT item_id, kind, status, value_json, force, appreciation, author FROM pm_reasoning_items WHERE project_id=dossier();
```

`pm_reasoning_turns` empêche de rejouer un tour. Les tables de l’ancien modèle (`pm_reasoning_results`, `_nodes`, `_relations`, `_links`, `_theories`) sont supprimées au démarrage.

## Fichiers

- `shared/piecemaker-reasoning.ts` : contrat partagé.
- `server/modules/piecemaker-reasoning/` : analyseur Catala, évaluation et vérifications, persistance, verrous, routes ; tests dans `tests/raisonnement.test.ts`.
- `server/piecemaker/harness/citation-{instructions,turn}.ts` : instruction, masquage des blocs, capture des périodes et de l’historique, branchement en fin de tour ; test `reasoning-turn.test.ts`.
- `server/piecemaker/vendor/mcp/legifrance/tools/decision_history.py` : `controle_historique`, appelé par `consulter_decision`.
- `plugins/piecemaker-raisonnement/` : volet (schéma, code, sources).
