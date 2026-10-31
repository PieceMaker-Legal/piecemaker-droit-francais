# tabular_review_index

**L’index du dossier est une tabular review : une seule par dossier lit toutes les pièces, une ligne par pièce, pour la chronologie et le tri.** La commande reprend les sous-commandes de `tabular_review`, avec deux différences :

- l’index s’affiche toujours dans l’onglet Dossier, jamais dans le volet Tabular Review ;
- le fichier et le projet sont déduits : n’indiquez ni `--fichier` ni `--projet`.

```
pm tabular_review_index ouvrir
pm tabular_review_index preparer [--questions JSON] [--documents a,b]
pm tabular_review_index lancer [--ia claude|codex|mistral] [--modele-ia TEXT]
pm tabular_review_index lire
pm tabular_review_index colonnes --questions JSON
pm tabular_review_index classement
pm tabular_review_index arborescence [--dossiers JSON]
pm tabular_review_index relancer
pm tabular_review_index lister [--dossier NOM]
pm tabular_review_index modifier --piece doc:1 --date 2024-03-01 --libelle 2024-03-01_Lettre
```

`ouvrir` retrouve l’index, ou le prépare s’il manque. `preparer` et `lancer` valent avant le lancement ; `lire`, `colonnes`, `classement` et `relancer` valent après.

`classement` ajoute la colonne qui classe chaque document dans l’arborescence du dossier. `arborescence --dossiers` remplace cette arborescence : `[{nom, explication}]`, un « / » crée un sous-dossier. Sans `.piecemaker/arborescence.json`, la base est Projets, Pièces, Archives, Notes et recherches. Enregistrer l’arborescence ne déplace aucun fichier. Dès que le volet affiche une réponse de la colonne de classement, il range la pièce, sans confirmation ; pour corriger, l’avocat change la valeur dans le tableau.

`lister` et `modifier` portent sur les dates et les libellés des pièces en base, et ne lisent pas les pièces. `lister` : id, date, libellé, nature. `modifier` : date (`AAAA-MM-JJ`, vide pour l’effacer) et/ou libellé (renomme le fichier). `--dossier NOM` = un autre dossier.

Format de `--questions` et règles de `colonnes` : `tabular.md`.
