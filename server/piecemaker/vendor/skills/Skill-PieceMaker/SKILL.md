---
name: piecemaker
description: Outils du dossier PieceMaker — SQL (pièces, personnes, mentions), conversion, index des pièces, suivi du dossier (échéances), raisonnement juridique (écrire, compléter, vérifier, consulter le volet Raisonnement), volets, tabular review et liaison DOCX au raisonnement. Use when the user asks about case documents, deadlines or the case follow-up, the legal reasoning (raisonnement) or its panel, linked DOCX reasoning, the chronology, SQL on the dossier, converting pieces, opening or closing a panel, or a tabular review.
---

# PieceMaker

L’application PieceMaker doit tourner. `pm` vise le dossier de la session, même lancé depuis un autre répertoire (`--dossier PATH` pour un autre) :

```
<cette-skill>/scripts/pm <outil> …
<cette-skill>/scripts/pm --help
```

## Lire avant d'agir

Avant d'utiliser un de ces outils, lisez sa référence dans `<cette-skill>/references/`.

| Besoin | Outil | Référence |
| --- | --- | --- |
| Échéances, fiche `matter` | `pm suivi` | `suivi.md` |
| Demande transmise par le tableau, état des dossiers | `pm suivi lire`, `pm suivi ecrire` | `tableau.md` |
| Lier un DOCX existant à un raisonnement | `pm docx` | `docx-lie.md` |
| Analyse de pièces, recherche de jurisprudence | `pm tabular_review` | `tabular.md` |
| Lecture de toutes les pièces, chronologie, tri, dates des pièces | `pm tabular_review_index` | `index.md` |
| Lire, pointer ou fermer un volet | `pm afficher` | `volets.md` |
| Préparer un bordereau | `.piecemaker/last-stamping.json` | `bordereau.md` |

## Volets

Le geste ouvre le volet tout seul : `sql` (écriture), `tabular_review` (lister, preparer, lancer, ouvrir), `tabular_review_index`, un `.docx` écrit ou édité, `raisonnement` (volet Raisonnement du dossier). Une ligne `Visible : …` le confirme. N’appelez pas `afficher` après ces commandes.

Un `.docx` s’ouvre dans la visionneuse tout seul. Conversion n’ouvre aucun volet.

## raisonnement

Le raisonnement juridique du dossier vit dans `.piecemaker/raisonnements/<nom>.yaml`. Le volet Raisonnement le montre à l'avocat.

1. Avant d'écrire ou de compléter un raisonnement, lancez `pm raisonnement consignes`. Suivez ces règles.
2. `pm raisonnement lister` montre les raisonnements du dossier, avec leurs objectifs et leur dernier bilan.
3. `pm raisonnement verifier --raisonnement <nom>` vérifie le fichier, le réécrit et ouvre le volet. Corrigez et relancez jusqu'à zéro erreur.

## sql

Noms réels masqués. `dossier()` = affaire courante ; `dossier('nom ou id')` = une autre.

```
piecemaker_nodes(project_id, id, kind, label, doc_date, aliases_json, data_json)
  kind 'document' = pièce (doc_date AAAA-MM-JJ ; data_json.nature, .localisation)
  sinon personne, société, coordonnée (data_json.partySide, .position, .legalForm)
piecemaker_links(project_id, from_node_id, to_node_id, relation)
  'mentions' = la pièce cite l’entité
piecemaker_citations(project_id, from_node_id, to_node_id, relation, texte, piece_id, source)
  source = pièce (piece_id) ou référence libre
```

Dates auto. Renommer une pièce = `UPDATE` de son `label` (`AAAA-MM-JJ_titre`).

```
pm sql --requete "SELECT id, label FROM piecemaker_nodes WHERE project_id = dossier() AND kind = 'document'"
```

## conversion

Convertit **et** scanne (GLiNER). Plusieurs minutes. Un scan à la fois. `--force` reconvertit les pièces déjà prêtes.

```
pm conversion
pm conversion --force contrat.pdf
```

Sans MinerU, le Markdown d’un scan est vide ou presque : signalez-le, n’en concluez pas que la pièce est vide.

## Historique du dossier

Le dossier est un dépôt Git local. PieceMaker commite seul à la fin du tour : ne commitez pas. Consultez et restaurez avec `git log`, `git show`, `git diff` et `git restore --source <sha> -- FICHIER`. N’utilisez ni `reset`, `rebase`, `switch`, `stash`, `clean`, ni remote.
