---
name: piecemaker
description: Outils du dossier PieceMaker, une commande pm par onglet — dossier (verifier, SQL sur pièces, personnes et mentions, conversion, index des pièces), suivi du dossier (échéances), raisonnement juridique (écrire, compléter, vérifier, consulter le volet Raisonnement), bordereau et tampon, volets et tabular review. Use when the user asks about case documents, deadlines or the case follow-up, the legal reasoning (raisonnement) or its panel, the chronology, SQL on the dossier, converting pieces, stamping or numbering pieces, opening or closing a panel, or a tabular review.
---

# PieceMaker

## Lancer `pm`

1. Lancez `pm <outil> …`. `pm` est dans le PATH.
2. Si la commande échoue, lisez l'erreur, corrigez, relancez.
3. Ne demandez jamais à l'utilisateur de lancer `pm`.

`pm` vise le dossier de la session, depuis tout répertoire. `--dossier "CHEMIN"` vise un autre dossier. `pm --help` liste les outils.

## Une commande par onglet

Avant d'utiliser une commande, lisez sa référence dans `<cette-skill>/references/`.

| Commande | Rôle | Référence |
| --- | --- | --- |
| `pm tab` | lister, afficher ou fermer un volet ou un fichier | `tab.md` |
| `pm dossier` | verifier le dossier, sql, conversion, arborescence, index des pièces | `dossier.md` |
| `pm tabular_review` | analyse de pièces, recherche de jurisprudence, modèles | `tabular.md` |
| `pm bordereau` | tamponner et numéroter les pièces | `bordereau.md` |
| `pm raisonnement` | verifier ou lister les raisonnements juridiques | `raisonnement.md` |
| `pm suivi_dossiers` | verifier le suivi des échéances, lire ou ecrire le tableau | `suivi.md`, `tableau.md` |

Au début du travail sur un dossier, lancez `pm dossier verifier`.

## Volets

Le geste ouvre le volet tout seul : `pm dossier sql` (écriture), `pm dossier index`, `pm tabular_review` (lister, preparer, lancer), `pm raisonnement verifier`, `pm bordereau`, un `.docx` écrit ou édité. Une ligne `Visible : …` le confirme. N'appelez pas `pm tab afficher` après ces commandes. La conversion n'ouvre aucun volet.

## raisonnement

Le raisonnement juridique du dossier vit dans `.piecemaker/raisonnements/<nom>.yaml`. Le volet Raisonnement le montre à l'avocat.

1. Avant d'écrire ou de compléter un raisonnement, lisez `raisonnement.md`. Suivez ces règles.
2. `pm raisonnement lister` montre les raisonnements du dossier, avec leurs objectifs et leur dernier bilan.
3. `pm raisonnement verifier --raisonnement <nom>` vérifie le fichier, le réécrit et ouvre le volet. Corrigez et relancez jusqu'à zéro erreur.

## Historique du dossier

Le dossier est un dépôt Git local. PieceMaker commite seul à la fin du tour : ne commitez pas. Consultez et restaurez avec `git log`, `git show`, `git diff` et `git restore --source <sha> -- FICHIER`. N’utilisez ni `reset`, `rebase`, `switch`, `stash`, `clean`, ni remote.
