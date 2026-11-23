---
name: piecemaker
description: Outils du dossier PieceMaker, une commande pm par onglet — dossier (verifier, SQL sur pièces, personnes et mentions, conversion, index des pièces), suivi du dossier (échéances), bordereau et tampon, volets et tabular review. Use when the user asks about case documents, deadlines or the case follow-up, the chronology, SQL on the dossier, converting pieces, stamping or numbering pieces, opening or closing a panel, or a tabular review.
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
| `pm objectifs` | verifier les objectifs du dossier et les parties de chacun (`.piecemaker/objectifs.md`), d'où part tout le reste | `objectifs.md` |
| `pm check` | bilan du dossier, avec la commande ou le sous-agent qui corrige chaque défaut | `check.md` |
| `pm tab` | lister, afficher ou fermer un volet ou un fichier | `tab.md` |
| `pm dossier` | sql, conversion, arborescence, index des pièces | `dossier.md` |
| `pm tabular_review` | analyse de pièces, recherche de jurisprudence, modèles | `tabular.md` |
| `pm bordereau` | tamponner et numéroter les pièces | `bordereau.md` |
| `pm suivi_dossiers` | verifier le suivi des échéances, lire ou ecrire le tableau | `suivi.md`, `tableau.md` |
| `pm memoire` | verifier la mémoire d'un projet (section « ## Mémoire : <nom> » de l'About.md du dossier, ou `.piecemaker/memoires/<nom>.md` sans brain) | `suivi.md` |
| `pm okf` | `verify` l'index OKF du dossier et les éléments manquants du graphe, `link` ou `unlink` pièces, prémisses et parties, `examinee` une pièce lue sans lien, `revue` lie une colonne de revue tabulaire à une prémisse | `okf.md` |
| `pm catala` | verifier un programme Catala (format, tests, preuve, Catleg) | skill `catala` |

Au début du travail sur un dossier, lisez `.piecemaker/objectifs.md`, puis lancez `pm check`.

## Sous-agents

Lancez `research-maker` au premier plan, jamais en arrière-plan. Attendez son compte rendu, puis finissez dans le même tour le travail demandé. Ne planifiez pas de reprise et ne suspendez pas le travail.

## Volets

Le geste ouvre le volet tout seul : `pm dossier sql` (écriture), `pm dossier index`, `pm tabular_review` (lister, preparer, lancer), `pm bordereau`, un `.docx` écrit ou édité. Une ligne `Visible : …` le confirme. N'appelez pas `pm tab afficher` après ces commandes. La conversion n'ouvre aucun volet.

## Historique du dossier

Le dossier est un dépôt Git local. PieceMaker commite seul à la fin du tour : ne commitez pas. Consultez et restaurez avec `git log`, `git show`, `git diff` et `git restore --source <sha> -- FICHIER`. N’utilisez ni `reset`, `rebase`, `switch`, `stash`, `clean`, ni remote.
