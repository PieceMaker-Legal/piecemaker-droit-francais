# dossier

```
pm dossier sql "REQUÊTE"
pm dossier conversion [--force] [pièce…]
pm dossier arborescence [--dossiers JSON] [--motif "raison"]
pm dossier index lancer [--ia claude|codex|mistral] [--modele-ia TEXT]
pm dossier index lire
pm dossier index colonnes --questions JSON
```

## conversion

Convertit en Markdown **et** pseudonymise (GLiNER). Sans pièce : toutes les pièces pas encore prêtes. `--force` reconvertit les pièces déjà prêtes.

La commande attend au plus 90 s, qu’elle lance la conversion ou qu’une conversion tourne déjà. Au-delà, elle renvoie l’avancée et le travail continue en arrière-plan dans PieceMaker. Ne la relancez pas en boucle : traitez d’abord le programme Catala, le raisonnement et le suivi, qui ne lisent pas les pièces. L’index et les prémisses attendent la fin du scan. Revenez ensuite à `pm dossier conversion`.

Sans MinerU, le Markdown d’un scan est vide ou presque : signalez-le, n’en concluez pas que la pièce est vide.

## index

**L’index du dossier est une tabular review : une seule par dossier lit toutes les pièces, une ligne par pièce, pour la chronologie et le tri.** `lancer`, `lire` et `colonnes` l’ouvrent dans la fenêtre « Analyse tabulaire » de l’onglet Dossier. Le fichier et le projet sont déduits.

- `lancer` crée l’index s’il manque, puis l’analyse. S’il existe, analyse les pièces converties absentes de l’index. Lancez-le sur accord de l’avocat.
- `lire` résume l’index : statut, questions, puis une ligne par pièce avec sa réponse courte à chaque question.
- `colonnes` ajoute, modifie ou retire une question : format dans `tabular.md`.

La colonne de classement range chaque pièce dans l’arborescence, sans confirmation. Après `pm dossier index lancer`, le serveur range chaque pièce dès que sa ligne est analysée, même si l’index n’est pas affiché. Un lancement fait depuis l’interface la range quand le volet affiche la réponse. Pour corriger, l’avocat change la valeur dans le tableau.

## arborescence

`pm dossier arborescence` lit l’arborescence et la proposition en attente. Pour proposer un changement, modifiez `.piecemaker/arborescence.json` avec l’outil Edit ou Write (Codex : apply_patch), jamais par le shell : le hook `guard-ontologie` refuse l’écriture, fusionne la modification dans la proposition en attente (`arborescence.proposition.json`) et vous répond ce qui a changé. Chaque modification s’ajoute à la proposition en attente. `--dossiers JSON` propose aussi une arborescence complète : `[{nom, explication}]`, un « / » crée un sous-dossier ; `--motif` dit pourquoi. La proposition ne change rien : l’avocat accepte, refuse ou modifie chaque changement dans l’onglet Index › Classement, puis enregistre. Une nouvelle proposition remplace la précédente. Sans arborescence, la base est Projets, Pièces, Archives, Notes et recherches. Les dossiers de premier niveau sont les types de documents. Aucun fichier n’est déplacé.

## classer

`pm dossier classer <document> <dossier>` range un document dans un dossier de l’arborescence. Le document prend le type de ce dossier ; son Markdown et son nœud suivent. `pm check` nomme les documents sans type.

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
