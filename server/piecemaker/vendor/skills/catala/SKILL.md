---
name: catala
description: Écrire et vérifier un programme Catala qui code une règle juridique du dossier (calcul de montant, de délai, de seuil, conditions et exceptions) — typecheck, format, tests clerk, tests Python, preuve d'absence de conflit entre exceptions, explication d’une exécution, vigueur des articles cités avec catleg. Use when the user asks for Catala, a formal or executable version of a legal rule, a proof that exceptions do not overlap, or a check that cited articles are still in force.
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

1. Créez `clerk.toml` avec `[project]` et `name = "<nom>"`.
2. Écrivez le module : `> Module Nom` en tête, nom de fichier en minuscules (`nom.catala_fr`).
3. Mettez les déclarations exposées aux autres fichiers dans des blocs ` ```catala-metadata `. Un module n'expose que ces blocs. Sinon les tests échouent à la compilation (« Could not resolve reference »).
4. Mettez les définitions dans des blocs ` ```catala `. Citez le texte en Markdown au-dessus du bloc qui le code.
5. Reprenez les pièces et citations du dossier dans le Markdown associé à chaque règle ou donnée. Écrivez les extraits sous la forme `Citation : « passage exact »` après leur lien. Évitez les lignes commençant par `>` : Catala les réserve à ses directives. Titrez chaque article cité `## Article 1218 | LEGIARTI000032041431`. catleg lit ces titres.
6. Écrivez les tests dans `test_<module>.catala_fr` : `> Usage de Nom`, un champ d'application `#[test]` par scénario, avec `assertion`. Utilisez des faits fictifs ou ceux du dossier, jamais d'autres.
7. Codez une exception avec `étiquette` et `exception`. Deux exceptions qui peuvent s'appliquer ensemble sont un conflit : `pm catala preuve` le détecte.

## Vérifier

1. `pm catala verifier --programme <nom>` : typecheck avec invariants, format, tests clerk, tests Python, puis graphe du scénario réussi. Le volet se met à jour après la commande. Corrigez et relancez jusqu'à « vérifié ».
2. `pm catala formater --programme <nom>` réécrit les fichiers au format officiel.
3. `pm catala preuve --scope <Champ> [--fichier F]` prouve l'absence de conflit et d'erreur. Le mode `--whole-program` est refusé : Catala 1.3 peut y masquer des conflits. Lancez la preuve sur chaque champ métier de chaque fichier ; les champs appelés ne sont pas couverts. Un `[WARNING]` est un échec : lisez le contre-exemple.
4. `pm catala catleg [--fichier F] [--au AAAA-MM-JJ]` vérifie la vigueur des articles cités, avec les identifiants PISTE de PieceMaker.
5. `pm catala lister` montre les programmes et leur dernier bilan. `pm catala env` montre le pack, son état d'installation et le Python utilisé.
6. `pm catala exec <catala|clerk|catala-lsp|catala-format|catala-dap> -- <arguments>` lance un outil du pack avec son environnement (LSP et débogueur pour un éditeur, commandes non couvertes).

## Expliquer une exécution

`pm catala expliquer --programme <nom> --fichier test_<module>.catala_fr --scope <Scenario>` produit le graphe des formules et conditions appliquées.

Choisissez un champ sans entrées : ses données doivent être fixées dans le scénario. Indiquez `--fichier` quand le programme contient plusieurs fichiers.

La vérification produit déjà le graphe. Utilisez `expliquer` pour choisir un autre scénario. Le volet affiche le graphe et ses états ouverts, sans surveillance des fichiers. Les flèches pointillées représentent les conditions. Aucun Graphviz n’est nécessaire.

L’explication concerne cette exécution seulement. Elle ne remplace ni les tests, ni la preuve du programme, ni la justification des faits.

Les résultats vont dans `.piecemaker/catala/<nom>/resultats/` : `verification.json`, `tests.json`, `preuve.json`, `catleg.json`, `explication.json`, `explication.dot` et un journal par contrôle.

## Limites à dire à l'avocat

- Catleg vérifie les articles reconnus dans les titres Markdown, avec les identifiants PISTE existants. Zéro article contrôlé ne vaut jamais validation. `--au` compare les périodes officielles à une date justifiée par le dossier, via la commande native `catleg lf article`. Ce contrôle ne prouve pas l’applicabilité juridique ni les dispositions transitoires.
- Catala 1.3 peut omettre des obligations pour des définitions globales. La preuve valide seulement les obligations produites. Une preuve sans obligation échoue.
- Une preuve porte sur le programme. Elle ne prouve ni les faits, ni la fidélité du programme au texte.
- Le programme ne lit pas les pièces. Le lien entre les entrées du programme et les pièces passe par une table des sources que l'avocat construit (qualification, lien officiel, pièce).
- Si `catala-format` signale « Failed idempotence check », le formateur bute sur la construction : gardez la forme écrite et signalez-le.

Répondez à l'avocat sans code : la règle codée, les scénarios testés, le résultat des contrôles et ces limites.
