# dossier

```
pm dossier sql "REQUÊTE"
pm dossier conversion [--force] [pièce…]
pm dossier arborescence --dossiers JSON
pm dossier index lancer [--ia claude|codex|mistral] [--modele-ia TEXT]
pm dossier index lire
pm dossier index colonnes --questions JSON
```

## conversion

Convertit en Markdown **et** pseudonymise (GLiNER). Sans pièce : toutes les pièces pas encore prêtes. `--force` reconvertit les pièces déjà prêtes.

La commande attend au plus 90 s. Au-delà, ou si une conversion tourne déjà, elle renvoie l’avancée : relancez `pm dossier conversion` pour suivre. Le travail continue dans PieceMaker.

Sans MinerU, le Markdown d’un scan est vide ou presque : signalez-le, n’en concluez pas que la pièce est vide.

## index

**L’index du dossier est une tabular review : une seule par dossier lit toutes les pièces, une ligne par pièce, pour la chronologie et le tri.** Il s’affiche dans l’onglet Dossier. Le fichier et le projet sont déduits.

- `lancer` crée l’index s’il manque, puis l’analyse. S’il existe, analyse les pièces converties absentes de l’index. Lancez-le sur accord de l’avocat.
- `lire` résume l’index : statut, questions, puis une ligne par pièce avec sa réponse courte à chaque question.
- `colonnes` ajoute, modifie ou retire une question : format dans `tabular.md`.

La colonne de classement range chaque pièce dans l’arborescence. Dès que le volet affiche sa réponse, il range la pièce, sans confirmation ; pour corriger, l’avocat change la valeur dans le tableau.

## arborescence

Lisez `.piecemaker/arborescence.json`. `pm dossier arborescence --dossiers JSON` la remplace : `[{nom, explication}]`, un « / » crée un sous-dossier. Sans ce fichier, la base est Projets, Pièces, Archives, Notes et recherches. Enregistrer l’arborescence ne déplace aucun fichier.

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

Dates des pièces :

```
pm dossier sql "SELECT id, doc_date AS date, label AS libelle, json_extract(data_json, '$.nature') AS nature FROM piecemaker_nodes WHERE project_id = dossier() AND kind = 'document' ORDER BY doc_date IS NULL, doc_date, label"
```

Changer la date (`NULL` pour l’effacer) ou le libellé d’une pièce. Le libellé `AAAA-MM-JJ_titre` renomme le fichier :

```
pm dossier sql "UPDATE piecemaker_nodes SET doc_date = '2024-03-01', label = '2024-03-01_Lettre' WHERE project_id = dossier() AND kind = 'document' AND id = 'doc:1'"
```

Une écriture ouvre l’index.
