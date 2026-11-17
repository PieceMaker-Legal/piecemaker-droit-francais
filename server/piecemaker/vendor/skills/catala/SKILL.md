---
name: catala
description: Écrire et vérifier un programme Catala qui code une règle juridique du dossier (calcul de montant, de délai, de seuil, conditions et exceptions) — pages du livre Catala, typecheck, format, tests clerk, tests Python, squelette de test, trace d'exécution, arbre des exceptions, preuve d'absence de conflit entre exceptions, explication d’une exécution, numéro, vigueur à la date retenue et texte intégral des articles cités avec catleg. Use when the user asks for Catala, a formal or executable version of a legal rule, a proof that exceptions do not overlap, or a check that cited articles are in force at the chosen date and copied in full.
---

# Catala

> Lisez les pièces, puis écrivez vous-même le programme avec ce skill et ses prémisses avec le skill `okf`. Une source manque → `research-maker`.

Catala code une règle juridique en programme exécutable. Le pack Catala est installé par l'app de bureau PieceMaker. Lancez chaque outil par `pm catala`, jamais par un chemin direct. `pm catala verifier` contrôle documentation, typage, format, tests, preuve, vigueur et citations : ce skill ne répète pas ses règles, suivez ses messages.

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
  "type": "litigation",
  "date_vigueur": "2024-01-15",
  "raisonnements": [
    { "champ": "RejetDeLaDemande", "objectif": "Faire rejeter la demande en paiement", "rang": "À titre principal" },
    { "champ": "ReductionDuMontant", "objectif": "Faire réduire le montant", "rang": "À titre subsidiaire" }
  ]
}
```

- `tache` nomme l'acte comme l'avocat. `type` : `litigation` (contentieux) ou `transactional` (contrat, acte).
- `date_vigueur` : date à laquelle le droit s'apprécie, tirée des pièces (conclusion du contrat, fait générateur, acte), sinon demandée à l'avocat. `today` se résout à la date de chaque vérification. Catleg la lit.
- `champ` : nom exact du champ qui porte la conclusion. `objectif` : celui annoncé par l'avocat ; demandez-le s'il manque. `rang` : `À titre principal`, `À titre subsidiaire` ou la clause.

## Démarche

1. Lisez les pièces et les textes. Formulez la question juridique.
2. Écrivez `tache.json`, puis `clerk.toml` (`[project]`, `name = "<nom>"`).
3. Écrivez le module sur le modèle de `references/format.md` : `> Module Nom` dans `nom.catala_fr`, chaque article sous son propre titre, son extrait exact, son texte intégral, puis ses blocs ` ```catala `. Ajoutez chaque section source par `pm catala section`, puis écrivez son bloc dessous.
4. Déclarez chaque fait du dossier comme un `contexte` : `condition` s'il est vrai ou faux, `contenu argent`, `entier` ou `date` s'il porte une valeur (`references/format.md`). Établissez les prémisses avec le skill `okf`.
5. Écrivez `test_<module>.catala_fr` : un scénario `#[test]` par raisonnement, avec ses assertions et les faits du dossier, chacun sous `## okf:/_premises/<fiche>.md`.
6. Le Hérisson lance `pm catala verifier` après chaque écriture d'un fichier du programme et rend les messages nouveaux : suivez chacun jusqu'à « vérifié ». Ne le lancez pas vous-même. Lancez ensuite `pm okf verify`.

## Où chercher

Lisez la page avant d'écrire, pas de mémoire : le site catala-lang.org peut vous être inaccessible.

| Besoin ou erreur | Lire |
|---|---|
| Fichier complet, faits du dossier | `references/format.md` |
| Erreur dont le message ne donne pas la correction | `references/pieges.md` |
| Graphe, titres, carte visée par l'avocat | `references/graphe.md` |
| Titres, extraits, blocs, mots réservés | `references/livre/5-1-literate-programming.md` |
| Types, dates, durées, argent, énumérations, listes | `references/livre/5-2-types.md` |
| Entrée, résultat, `condition`, états, sous-champs | `references/livre/5-3-scopes-toplevel.md` |
| Définition conditionnelle, `étiquette`, `exception`, arrondi des dates | `references/livre/5-4-definitions-exceptions.md` |
| `selon … sous forme`, `soit … dans`, conditionnelles, listes | `references/livre/5-5-expressions.md` |
| `> Module`, `> Usage de`, `catala-metadata` | `references/livre/5-6-modules.md` |
| Fonction de la bibliothèque standard (`Date`, `Argent`, `Liste`…) | `references/livre/5-7-standard-library.md` |
| `#[test]`, `##`, attributs | `references/livre/5-8-1-attributes.md` |
| `condition` ou `règle`, conversions, arrondi d'un montant, pas de texte | `references/livre/4-2-catala-specific.md` |
| Écrire un test, assertions | `references/livre/3-3-0-test-ci.md` |
| Programme complet commenté | `references/livre/tutoriel_fin_2_1.catala_fr` à `tutoriel_fin_2_4.catala_fr` |

## Modéliser

- Séparez faits, qualifications, conditions et exceptions. Une notion à apprécier (délai raisonnable, faute grave) est une définition argumentée et sourcée, pas une entrée.
- Codez une exception avec `étiquette` et `exception`. Choisir la règle qui l'emporte est une interprétation : justifiez-la en commentaire `#` au-dessus de l'exception et signalez-la à l'avocat.
- Pour une date de fin de mois ou un montant, choisissez l'arrondi d'après le texte et testez le cas limite.
- Écrivez les justifications en commentaires `#`. Nommez les identifiants en français, avec les accents. N'inventez aucun extrait, aucune pièce, aucun fait. Si une source manque, signalez-la et recherchez-la.

## Style des titres

Le titre `##` nomme la case du graphe. L’avocat le lit sans le code. `verifier` contrôle sa longueur ; relisez sa forme.

| Case | Forme | Exemples | À éviter |
|---|---|---|---|
| Règle, condition, qualification, calcul | Verbe à l’infinitif, puis son objet | `Vérifier le montant demandé`, `Calculer l’indemnité` | `Montant`, `Le montant est-il dû ?` |
| Fait, clause ou pièce | Nom, puis participe passé qui constate | `Montant demandé`, `Contrat conclu` | `Contrat`, `Vérifier le contrat` |

- Écrivez dans la langue du programme. Ni phrase, ni point final, ni numéro d’article.
- Reprenez les mêmes mots dans la condition et dans le fait qui la valide. N’annoncez pas le résultat dans le titre d’une règle.

## Commandes

- `pm catala verifier --programme <nom>` formate les fichiers puis lance tous les contrôles. Relisez un fichier « reformaté » avant de le modifier. Corrigez d'abord la compilation : elle bloque les autres contrôles.
- `pm catala section --programme <nom> --fichier <f>.catala_fr --source <LEGIARTI…|JURITEXT…> --extrait "…" [--titre "Article 1224"]` : ajoute à la fin du fichier le titre, l'extrait et le texte officiel. Lisez d'abord la source avec `consulter_article` ou `consulter_decision` (MCP legifrance). Un extrait qui n'est pas mot pour mot est refusé : recopiez-le du texte officiel.
- Le Hérisson compile le programme avant chaque écriture : une erreur de compilation nouvelle bloque l'écriture. Corrigez la ligne citée, puis réécrivez.
- `pm catala executer --scope <Scenario> [--fichier F]` : trace d'un test qui échoue. Filtrez le journal avec `grep "≔.*<identifiant>" .piecemaker/catala/<nom>/resultats/execution.log`.
- `pm catala exceptions --scope <Champ> --variable <v>` : arbre des exceptions, pour un conflit signalé par la preuve. La preuve contrôle deux choses par variable : aucune exception n'en chevauche une autre, et une définition s'applique dans tous les cas. Son message donne la variable, la ligne et un contre-exemple (les entrées qui provoquent le défaut) : ajoutez la condition ou l'exception qui couvre ce cas.
- `pm catala expliquer --scope <Scenario> [--fichier F]` : graphe d'un autre scénario sans entrées.
- `pm catala squelette --scope <Champ>` : test aux entrées par défaut, à compléter.

N'ouvrez pas les JSON de `resultats/` : ils servent au volet. Le bouton « Rédiger » du volet ouvre un chat de rédaction (skill `style-redaction-cabinet`), hors de `.piecemaker/catala/`.

## Limites à dire à l'avocat

- Catleg contrôle le numéro, le texte intégral et la vigueur à `date_vigueur` (ou `--au`). Zéro article contrôlé ne vaut pas validation. Ce contrôle ne prouve ni l'applicabilité ni les dispositions transitoires.
- La preuve porte sur le programme : ni sur les faits, ni sur sa fidélité au texte. Catala 1.3 peut omettre des obligations pour des définitions globales.
- L'explication concerne une exécution. Elle ne remplace ni les tests, ni la preuve, ni la justification des faits.

Répondez sans code : la règle codée, les scénarios testés, le résultat des contrôles et ces limites. Citez les articles lus (identifiant Légifrance) et les pièces lues, jamais votre mémoire ni vos fichiers.

## Sources

Les pages de `references/livre/` sont copiées sans modification du *livre Catala*, © 2025 l'équipe Catala (auteur principal Denis Merigoux, avec Romain Primet, Louis Gesbert, Vincent Botbol et les contributeurs du livre), sous licence CC BY 4.0 : https://github.com/CatalaLang/catala-book, https://book.catala-lang.org. Dépôt, commit et liste des fichiers : `references/livre/SOURCE.md`.
