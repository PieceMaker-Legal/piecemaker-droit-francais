---
name: catala
description: Écrire et vérifier un programme Catala qui code une règle juridique du dossier (calcul de montant, de délai, de seuil, conditions et exceptions) — fiche de syntaxe vérifiée, typecheck, format, tests clerk, tests Python, squelette de test, trace d'exécution, arbre des exceptions, preuve d'absence de conflit entre exceptions, explication d’une exécution, vigueur des articles cités avec catleg. Use when the user asks for Catala, a formal or executable version of a legal rule, a proof that exceptions do not overlap, or a check that cited articles are still in force.
---

# Catala

> **Délégation.** Agent principal : lisez les pièces, puis écrivez vous-même le programme avec ce skill. Confiez ensuite ses prémisses à `premise-maker`, avec le nom du programme et, pour chacune : le chemin `okf:`, la question, le type et l’unité, la valeur attendue, les pièces repérées et le passage Catala qui lit le fait. `premise-maker` confirme, corrige ou déclare le fait absent ; un fait absent est écarté faute de preuve. Une source manque → `research-maker`. Sous-agent : vous êtes l'exécutant, appliquez ce skill. Sans sous-agent activé dans le dossier, faites le travail vous-même.

Catala code une règle juridique en programme exécutable. Le pack Catala est installé par l'app de bureau PieceMaker. Lancez chaque outil par `pm catala`, jamais par un chemin direct.

## Classement

Un programme Catala correspond à une tâche : un jeu de conclusions, un contrat ou un autre acte précis. Il vit dans `.piecemaker/catala/<nom>/`. `<nom>` s'écrit en minuscules, chiffres et tirets ; reprenez le nom de la mémoire de projet et du suivi de cet acte. Un dossier peut contenir plusieurs programmes ; indiquez alors `--programme <nom>`.

Une tâche contient un ou plusieurs raisonnements : une demande principale et une demande subsidiaire, ou les clauses d'un contrat. Chaque raisonnement est un champ d'application du même programme. Ne créez pas un programme par raisonnement : les faits et les pièces s'écrivent une seule fois.

```
.piecemaker/catala/
  prime-anciennete/              programme Catala
    clerk.toml                   [project] name = "prime-anciennete"
    tache.json                   tâche, type et raisonnements
    prime.catala_fr              > Module Prime
    test_prime.catala_fr         > Usage de Prime, scopes #[test]
    resultats/                   écrit par pm catala, ne pas modifier
```

## Décrire la tâche

Écrivez `tache.json` avant le programme, puis tenez-le à jour :

```json
{
  "tache": "Conclusions en défense Dupont / Société Exemple, TC Paris",
  "type": "contentieux",
  "date_vigueur": "2024-01-15",
  "raisonnements": [
    { "champ": "RejetDeLaDemande", "objectif": "Faire rejeter la demande en paiement", "rang": "À titre principal" },
    { "champ": "ReductionDuMontant", "objectif": "Faire réduire le montant", "rang": "À titre subsidiaire" }
  ]
}
```

- `tache` nomme l'acte, comme l'avocat le nomme.
- `type` vaut `contentieux`, `contrat` ou `autre`.
- `date_vigueur` est la date à laquelle le droit s'apprécie : `today` ou AAAA-MM-JJ. Catleg la lit. Sans elle ni `--au`, `verifier` s'arrête aussitôt sur une erreur.
- `champ` est le nom exact du champ d'application qui porte la conclusion du raisonnement.
- `objectif` reprend l'objectif annoncé par l'avocat. N'en inventez pas : demandez-le s'il manque.
- `rang` situe le raisonnement dans l'acte : `À titre principal`, `À titre subsidiaire`, ou la clause (`Clause 5 — Confidentialité`).

Le volet classe chaque scénario de test sous le raisonnement dont il appelle le champ. Écrivez au moins un scénario par raisonnement. `pm catala verifier` signale un `tache.json` illisible, un type inconnu, un champ absent du programme et un objectif manquant.

## Écrire le programme

Lisez d'abord `references/format.md` : modèle complet d'un fichier conforme au livre Catala. Lisez ensuite `references/syntaxe.md` : pièges fréquents, mots-clés et bibliothèque standard. Partez de ces modèles, pas de mémoire.

1. Créez `clerk.toml` avec `[project]` et `name = "<nom>"`.
2. Écrivez le module : `> Module Nom` en tête, nom de fichier en minuscules (`nom.catala_fr`).
3. Mettez les déclarations exposées aux autres fichiers dans des blocs ` ```catala-metadata `. Un module n'expose que ces blocs. Sinon les tests échouent à la compilation (« Could not resolve reference »).
4. Mettez les définitions dans des blocs ` ```catala `. Ouvrez chaque bloc exactement par ` ```catala ` ou ` ```catala-metadata ` : Catala ignore en silence un bloc ouvert autrement (espace, majuscule, suffixe). Placez chaque bloc juste sous l'article qui le fonde.
5. Titrez chaque article cité `## Article 1218 | LEGIARTI000032041431` : catleg lit ces titres pour contrôler la vigueur. Sous le titre, copiez l'extrait exact du texte entre « ». Évitez les lignes commençant par `>` : Catala les réserve à ses directives. Nommez les identifiants en français, avec les accents (`mise_en_demeure`, `résolution_possible`) : le volet les affiche tels quels à l'avocat.
6. Écrivez les tests dans `test_<module>.catala_fr` : `> Usage de Nom`, un champ d'application `#[test]` par scénario, avec au moins une `assertion` : un test sans assertion réussit toujours, `pm catala verifier` le refuse. Utilisez des faits fictifs ou ceux du dossier, jamais d'autres.
7. Codez une exception avec `étiquette` et `exception`. Deux exceptions qui peuvent s'appliquer ensemble sont un conflit : `pm catala verifier` le détecte. Choisir la règle qui l'emporte est une interprétation : vous pouvez la faire, mais rendez-la visible. Justifiez ce choix en commentaire `#` au-dessus de l'exception et signalez-le à l'avocat dans votre réponse.

## Rédiger un document

Le programme ne contient pas l'acte. Le bouton « Rédiger » du volet ouvre un nouveau chat avec le raisonnement du scénario et le style choisi dans `style-redaction-cabinet`. Rédigez alors le document avec ce skill, hors du dossier `.piecemaker/catala/`.

## Construire le graphe du raisonnement

Lisez `references/graphe.md` avant d'écrire ou reprendre un raisonnement destiné au graphe. Séparez les faits, leur qualification, les conditions et les exceptions. Une valeur de scénario ne prouve aucun fait.

## Sources et citations

Suivez `references/format.md`.

1. Rattachez chaque règle à son texte par sa position : titre de l'article, extrait exact entre « », puis le bloc ` ```catala `. N'écrivez ni `Concerne :` ni citation en double.
2. Titrez chaque définition et chaque entrée par `## texte court` sur la ligne au-dessus, selon « Style des titres ».
3. Déclarez chaque fait du dossier comme une `entrée` avec `#[piecemaker.source = "okf:/_premises/<titre normalisé>.md"]`. La prémisse porte les pièces et leurs citations.
   Si la prémisse manque, nommez-la quand même et ajoutez `#[piecemaker.question = "…"]`. `premise-maker` la cherche ensuite dans les pièces (skill `okf`).
4. Pour citer une pièce directement, écrivez `#[piecemaker.source = "<chemin de la pièce>"]` et `#[piecemaker.citation = "extrait exact"]`.
5. Pour une qualification ou un calcul, placez la règle sous le texte qui fonde l'opération et gardez les dépendances vers les faits distincts.
6. Écrivez les justifications et le raisonnement en commentaires `#`.
7. N'écrivez pas `#[doc]` : le titre `##` en est la forme courte et documente seulement le rôle de l'élément.
8. Lancez `pm catala verifier`, puis `pm okf verify`. Corrigez chaque erreur et chaque manque du graphe.
9. Si une source ou citation manque, signalez le manque et recherchez-la. N'inventez aucun passage pour satisfaire le contrôle.

## Style des titres

Le titre nomme la case du graphe. L’avocat le lit sans le code. Aucun contrôle ne vérifie ce style : relisez chaque titre.

| Case | Forme | Exemples | À éviter |
|---|---|---|---|
| Règle, condition, qualification, calcul | Verbe d’action à l’infinitif, puis son objet | `Vérifier le montant demandé`, `Calculer l’indemnité` | `Montant`, `Le montant est-il dû ?` |
| Fait ou clause (sa `source` est une prémisse `okf:`) | Nom, puis participe passé qui constate | `Montant demandé`, `Contrat conclu` | `Contrat`, `Vérifier le contrat` |

- Écrivez dans la langue du programme. En anglais : `Check the amount claimed`, `Amount claimed`.
- Écrivez 2 à 7 mots. N’écrivez ni phrase, ni question, ni point final, ni identifiant (`montant_demandé`), ni numéro d’article.
- Reprenez les mêmes mots dans la condition et dans le fait qui la valide : `Vérifier le montant demandé`, `Montant demandé`.
- N’annoncez pas le résultat dans le titre d’une règle : la couleur de la case le donne.

## Commandes

Contrôler, une seule commande :

- `pm catala verifier --programme <nom>` met les fichiers au format officiel, puis lance tous les contrôles : typage avec invariants, tests Clerk/Python, lecture de chaque prémisse `okf:` par une règle, preuve de chaque champ métier, Catleg, citations PieceMaker et graphe du scénario réussi. Le volet se met à jour après la commande.
- Lancez `pm catala verifier` seul. Les commandes séparées (`catleg`, `preuve`, `formater`) servent seulement à isoler un contrôle déjà signalé par `verifier`.
- La commande réécrit les fichiers : relisez un fichier signalé « reformatés » avant de le modifier.
- Sous un contrôle en échec, le bilan donne une ligne par erreur (`fichier:ligne.colonne: [ERROR] message`) ou par test faux (`fichier:ligne › Scenario : message`). Tant que la compilation échoue, les contrôles qui en dépendent sont bloqués : corrigez d'abord la compilation.
- Un `[WARNING]` de preuve est un échec : lisez le contre-exemple dans `resultats/preuve.log`.
- Corrigez et relancez jusqu'à « vérifié ».

Comprendre un échec :

- `pm catala executer --scope <Scenario> [--fichier F]` exécute un champ sans entrées et affiche sa trace : valeur de chaque variable et règle appliquée. Utilisez-la pour un test qui échoue.
- Pour la valeur d'une seule variable, filtrez ensuite le journal complet : `grep "≔.*<identifiant>" .piecemaker/catala/<nom>/resultats/execution.log`. Chaque ligne `≔` donne une variable et sa valeur.
- `pm catala exceptions --scope <Champ> --variable <v> [--fichier F]` affiche l'arbre des exceptions d'une variable. Utilisez-la pour un conflit signalé par la preuve.
- `pm catala expliquer --scope <Scenario> [--fichier F]` produit le graphe d'un autre scénario. Voir « Expliquer une exécution ».

Écrire :

- `pm catala squelette --scope <Champ> [--fichier F]` génère un test dont les entrées ont leur valeur par défaut. Copiez-le dans `test_<module>.catala_fr`, puis fixez les faits et ajoutez les assertions.

Hors parcours : `pm catala lister` (programmes et dernier bilan), `pm catala env` (pack, Python) et `pm catala exec <outil> -- <arguments>` (outil du pack, pour un éditeur).

## Expliquer une exécution

Choisissez un champ sans entrées : ses données doivent être fixées dans le scénario. Indiquez `--fichier` quand le programme contient plusieurs fichiers.

La vérification produit déjà le graphe. Utilisez `expliquer` pour choisir un autre scénario. Le volet présente chaque règle avec son fondement, sa valeur Vrai ou Faux dans le scénario et les faits qui la justifient, en graphe et en fil écrit, des faits à la conclusion. Aucun Graphviz n’est nécessaire.

L’explication concerne cette exécution seulement. Elle ne remplace ni les tests, ni la preuve du programme, ni la justification des faits.

N'ouvrez pas les fichiers JSON de `resultats/` : ils servent au volet. Lisez le bilan de la commande, ou filtrez un journal `.log` avec `grep`.

Les résultats vont dans `.piecemaker/catala/<nom>/resultats/` : `verification.json`, `tests.json`, `preuve.json`, `catleg.json`, `citations.json`, `explication.json`, `explication.dot` et un journal par contrôle.

Le bilan distingue réussite, échec, contrôle bloqué et contrôle indisponible. Catleg et les citations tournent en parallèle ; les commandes qui utilisent `_build` restent séquentielles. Le contrôle des citations réutilise PieceMaker, le MCP Légifrance et les identifiants PISTE existants. Il vérifie les extraits déclarés, sans ajouter de raisonnement juridique.

## Limites à dire à l'avocat

- Catleg vérifie les articles des titres Markdown et les identifiants cités dans le fichier, avec les identifiants PISTE existants. Zéro article contrôlé ne vaut jamais validation. La date de vigueur vient de `--au`, sinon de `date_vigueur` dans `tache.json` : `today` ou AAAA-MM-JJ. Sans date, `verifier` et `catleg` s'arrêtent sur une erreur. En contentieux, inscrivez dans `tache.json` la date à laquelle le droit s’apprécie (conclusion du contrat, fait générateur, acte de procédure), tirée des pièces ou donnée par l’avocat. Demandez-la seulement si les pièces ne la donnent pas, et inscrivez-la dans `date_vigueur`. Catleg compare la période officielle de chaque article à cette date, y compris pour un article abrogé depuis. Ce contrôle ne prouve pas l’applicabilité juridique ni les dispositions transitoires.
- Catala 1.3 peut omettre des obligations pour des définitions globales. La preuve valide seulement les obligations produites. Une preuve sans obligation échoue.
- Une preuve porte sur le programme. Elle ne prouve ni les faits, ni la fidélité du programme au texte.
- Le programme ne lit pas les pièces. Le lien entre les entrées du programme et les pièces passe par une table des sources que l'avocat construit (qualification, lien officiel, pièce).
- Si le contrôle `format` échoue avec « Failed idempotence check », le formateur bute sur la construction : gardez la forme écrite et signalez-le.

Répondez à l'avocat sans code : la règle codée, les scénarios testés, le résultat des contrôles et ces limites.

Citez dans la réponse les articles lus (identifiant Légifrance) et les pièces lues. Ne citez jamais votre mémoire ni les fichiers que vous avez écrits (programme, résultats) comme source juridique.
