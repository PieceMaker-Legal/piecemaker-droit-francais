---
name: catala
description: Écrire et vérifier un programme Catala qui code une règle juridique du dossier (calcul de montant, de délai, de seuil, conditions et exceptions) — typecheck, format, tests clerk, tests Python, preuve d'absence de conflit entre exceptions, vigueur des articles cités avec catleg. Use when the user asks for Catala, a formal or executable version of a legal rule, a proof that exceptions do not overlap, or a check that cited articles are still in force.
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
5. Titrez chaque article cité `## Article 1218 | LEGIARTI000032041431`. catleg lit ces titres.
6. Écrivez les tests dans `test_<module>.catala_fr` : `> Usage de Nom`, un champ d'application `#[test]` par scénario, avec `assertion`. Utilisez des faits fictifs ou ceux du dossier, jamais d'autres.
7. Codez une exception avec `étiquette` et `exception`. Deux exceptions qui peuvent s'appliquer ensemble sont un conflit : `pm catala preuve` le détecte.

## Vérifier

1. `pm catala verifier --programme <nom>` : typecheck avec invariants, format, tests clerk, tests Python. Corrigez et relancez jusqu'à « vérifié ».
2. `pm catala formater --programme <nom>` réécrit les fichiers au format officiel.
3. `pm catala preuve --scope <Champ> [--fichier F] [--whole-program]` prouve l'absence de conflit et d'erreur. Utilisez `--whole-program` quand le champ appelle un autre module. Un `[WARNING]` est un échec : lisez le contre-exemple.
4. `pm catala catleg [--fichier F]` vérifie la vigueur des articles cités, avec les identifiants PISTE de PieceMaker.
5. `pm catala lister` montre les programmes et leur dernier bilan. `pm catala env` montre le pack, son état d'installation et le Python utilisé.
6. `pm catala exec <catala|clerk|catala-lsp|catala-format|catala-dap> -- <arguments>` lance un outil du pack avec son environnement (LSP et débogueur pour un éditeur, commandes non couvertes).

Les résultats vont dans `.piecemaker/catala/<nom>/resultats/` : `verification.json`, `tests.json`, `preuve.json`, `catleg.json` et un journal par contrôle.

## Limites à dire à l'avocat

- catleg contrôle la vigueur à la date du jour seulement. Il ne dit rien de la version applicable à la date des faits.
- Une preuve porte sur le programme. Elle ne prouve ni les faits, ni la fidélité du programme au texte.
- Le programme ne lit pas les pièces. Le lien entre les entrées du programme et les pièces passe par une table des sources que l'avocat construit (qualification, lien officiel, pièce).
- Sur Windows, `pm catala preuve` n'est pas disponible : le pack officiel ne fournit ni catala-proof ni Z3.
- Si `catala-format` signale « Failed idempotence check », le formateur bute sur la construction : gardez la forme écrite et signalez-le.

Répondez à l'avocat sans code : la règle codée, les scénarios testés, le résultat des contrôles et ces limites.
