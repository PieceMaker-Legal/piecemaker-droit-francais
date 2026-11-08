---
name: catala
description: Écrire et vérifier un programme Catala qui code une règle juridique du dossier (calcul de montant, de délai, de seuil, conditions et exceptions) — fiche de syntaxe vérifiée, typecheck, format, tests clerk, tests Python, squelette de test, trace d'exécution, arbre des exceptions, preuve d'absence de conflit entre exceptions, explication d’une exécution, vigueur des articles cités avec catleg. Use when the user asks for Catala, a formal or executable version of a legal rule, a proof that exceptions do not overlap, or a check that cited articles are still in force.
---

# Catala

Catala code une règle juridique en programme exécutable. Le pack Catala est installé par l'app de bureau PieceMaker. Lancez chaque outil par `pm catala`, jamais par un chemin direct.

## Classement

Un programme Catala vit dans `.piecemaker/catala/<nom>/`. `<nom>` s'écrit en minuscules, chiffres et tirets. Un dossier peut contenir plusieurs programmes ; indiquez alors `--programme <nom>`.

```
.piecemaker/catala/
  prime-anciennete/              programme Catala
    clerk.toml                   [project] name = "prime-anciennete"
    prime.catala_fr              > Module Prime
    test_prime.catala_fr         > Usage de Prime, scopes #[test]
    resultats/                   écrit par pm catala, ne pas modifier
```

## Écrire le programme

Lisez d'abord `references/syntaxe.md` : modèle vérifié, pièges fréquents, mots-clés et bibliothèque standard. Partez de ce modèle, pas de mémoire.

1. Créez `clerk.toml` avec `[project]` et `name = "<nom>"`.
2. Écrivez le module : `> Module Nom` en tête, nom de fichier en minuscules (`nom.catala_fr`).
3. Mettez les déclarations exposées aux autres fichiers dans des blocs ` ```catala-metadata `. Un module n'expose que ces blocs. Sinon les tests échouent à la compilation (« Could not resolve reference »).
4. Mettez les définitions dans des blocs ` ```catala `. Citez le texte en Markdown au-dessus du bloc qui le code.
5. Reprenez les pièces et citations du dossier dans le Markdown associé à chaque règle ou donnée. Écrivez les extraits sous la forme `Citation : « passage exact »` après leur lien. Évitez les lignes commençant par `>` : Catala les réserve à ses directives. Titrez chaque article cité `## Article 1218 | LEGIARTI000032041431`. catleg lit ces titres. Placez l'article ou la décision qui fonde une règle juste avant le bloc ` ```catala ` de cette règle : le volet les rattache à elle. Pour rattacher une pièce ou une source à une donnée ou à une autre règle, écrivez dans sa section `Concerne : <identifiant>` (plusieurs identifiants séparés par des virgules). Le volet montre les sources non rattachées à part. Nommez les identifiants en français, avec les accents (`mise_en_demeure`, `résolution_possible`) : le volet les affiche tels quels à l'avocat.
6. Écrivez les tests dans `test_<module>.catala_fr` : `> Usage de Nom`, un champ d'application `#[test]` par scénario, avec `assertion`. Utilisez des faits fictifs ou ceux du dossier, jamais d'autres.
7. Codez une exception avec `étiquette` et `exception`. Deux exceptions qui peuvent s'appliquer ensemble sont un conflit : `pm catala preuve` le détecte.

## Construire le graphe du raisonnement

Lisez `references/graphe.md` avant d'écrire ou reprendre un raisonnement destiné au graphe. Séparez les faits, leur qualification, les conditions et les exceptions. Une valeur de scénario ne prouve aucun fait.

## Vérifier

1. `pm catala verifier --programme <nom>` : typage avec invariants, format, tests Clerk/Python, preuves de tous les champs métier, Catleg, citations PieceMaker et graphe du scénario réussi. Le volet se met à jour après la commande. Sous un contrôle en échec, le bilan donne une ligne par erreur (`fichier:ligne.colonne: [ERROR] message`) ou par test faux (`fichier:ligne › Scenario : message`). Tant que la compilation échoue, les contrôles qui en dépendent, format compris, sont bloqués : corrigez d'abord la compilation. Corrigez et relancez jusqu'à « vérifié ».
2. `pm catala formater --programme <nom>` réécrit les fichiers au format officiel.
3. `pm catala preuve --scope <Champ> [--fichier F]` prouve l'absence de conflit et d'erreur. Le mode `--whole-program` est refusé : Catala 1.3 peut y masquer des conflits. Le vérificateur inventorie les champs métier avec `catala dependency-graph` puis prouve chaque champ séparément. Une commande `preuve` isolée ne couvre pas les champs appelés. Un `[WARNING]` est un échec : lisez le contre-exemple.
4. `pm catala catleg [--fichier F] [--au AAAA-MM-JJ]` vérifie la vigueur des articles cités, avec les identifiants PISTE de PieceMaker.
5. `pm catala lister` montre les programmes et leur dernier bilan. `pm catala env` montre le pack, son état d'installation et le Python utilisé.
6. `pm catala squelette --scope <Champ> [--fichier F]` génère un test dont les entrées ont leur valeur par défaut. Copiez-le dans `test_<module>.catala_fr`, puis fixez les faits et ajoutez les assertions.
7. `pm catala executer --scope <Scenario> [--fichier F]` exécute un champ sans entrées et affiche sa trace : valeur de chaque variable et règle appliquée. Utilisez-la pour comprendre un test qui échoue.
8. `pm catala exceptions --scope <Champ> --variable <v> [--fichier F]` affiche l'arbre des exceptions d'une variable. Utilisez-le pour contrôler la hiérarchie avant la preuve.
9. `pm catala exec <catala|clerk|catala-lsp|catala-format|catala-dap> -- <arguments>` lance un outil du pack avec son environnement (LSP et débogueur pour un éditeur, commandes non couvertes).

## Expliquer une exécution

`pm catala expliquer --programme <nom> --fichier test_<module>.catala_fr --scope <Scenario>` produit le graphe des formules et conditions appliquées.

Choisissez un champ sans entrées : ses données doivent être fixées dans le scénario. Indiquez `--fichier` quand le programme contient plusieurs fichiers.

La vérification produit déjà le graphe. Utilisez `expliquer` pour choisir un autre scénario. Le volet présente chaque règle avec son fondement, sa valeur Vrai ou Faux dans le scénario et les faits qui la justifient, en vue écrite et en graphe. Aucun Graphviz n’est nécessaire.

L’explication concerne cette exécution seulement. Elle ne remplace ni les tests, ni la preuve du programme, ni la justification des faits.

Les résultats vont dans `.piecemaker/catala/<nom>/resultats/` : `verification.json`, `tests.json`, `preuve.json`, `catleg.json`, `citations.json`, `explication.json`, `explication.dot` et un journal par contrôle.

Le bilan distingue réussite, échec, contrôle bloqué et contrôle indisponible. Catleg et les citations tournent en parallèle ; les commandes qui utilisent `_build` restent séquentielles. Le contrôle des citations réutilise PieceMaker, le MCP Légifrance et les identifiants PISTE existants. Il vérifie les extraits déclarés, sans ajouter de raisonnement juridique.

## Limites à dire à l'avocat

- Catleg vérifie les articles reconnus dans les titres Markdown, avec les identifiants PISTE existants. Zéro article contrôlé ne vaut jamais validation. `--au` compare les périodes officielles à une date justifiée par le dossier, via la commande native `catleg lf article`. Ce contrôle ne prouve pas l’applicabilité juridique ni les dispositions transitoires.
- Catala 1.3 peut omettre des obligations pour des définitions globales. La preuve valide seulement les obligations produites. Une preuve sans obligation échoue.
- Une preuve porte sur le programme. Elle ne prouve ni les faits, ni la fidélité du programme au texte.
- Le programme ne lit pas les pièces. Le lien entre les entrées du programme et les pièces passe par une table des sources que l'avocat construit (qualification, lien officiel, pièce).
- Si `catala-format` signale « Failed idempotence check », le formateur bute sur la construction : gardez la forme écrite et signalez-le.

Répondez à l'avocat sans code : la règle codée, les scénarios testés, le résultat des contrôles et ces limites.
