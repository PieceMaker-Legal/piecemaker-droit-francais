---
name: piecemaker
description: Outils du dossier PieceMaker — conversion Markdown+PII, SQL (pièces, personnes, mentions), chronologie, tabular review et affichage des volets. À utiliser à la place des outils MCP piecemaker. Use when the user runs /piecemaker or asks to query the case database, convert pieces, show chronology, open a panel, or run a tabular review.
---

# PieceMaker

Depuis le dossier de l’affaire (le serveur PieceMaker doit tourner) :

```
node <cette-skill>/scripts/pm.mjs <outil> …
node <cette-skill>/scripts/pm.mjs --help
```

| Outil | Quand |
| --- | --- |
| `sql` | Lire ou corriger la base (pièces, personnes, mentions, citations). |
| `conversion` | Convertir **et** scanner les pièces (GLiNER). Long. Un scan à la fois. |
| `chronologie` | Lister / dater / renommer les pièces. |
| `afficher` | Montrer un fichier ou un volet; sans cible, lister les volets ouverts. |
| `tabular_review` | Analyses tabulaires. `lancer` seulement si l’avocat l’a demandé. |

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
node …/pm.mjs sql --requete "SELECT id, label FROM piecemaker_nodes WHERE project_id = dossier() AND kind = 'document'"
```

## conversion

Plusieurs minutes. `--force` reconvertit les pièces déjà prêtes.

```
node …/pm.mjs conversion
node …/pm.mjs conversion --force contrat.pdf
```

## chronologie / afficher / tabular_review

```
node …/pm.mjs chronologie lister
node …/pm.mjs chronologie modifier --piece doc:1 --date 2024-03-01 --libelle 2024-03-01_Lettre
node …/pm.mjs afficher --fichier Actes/conclusions.docx
node …/pm.mjs afficher --volet chronologie
node …/pm.mjs afficher
node …/pm.mjs tabular_review lister
```
