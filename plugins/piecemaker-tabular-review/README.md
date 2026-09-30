# Tabular Review PieceMaker

Plugin CloudCLI d'analyse tabulaire de documents : une ligne par document (ou groupe de documents), une colonne par question d'un modèle, une session IA éphémère par ligne. Il occupe le slot `tab` et ajoute, par `piecemakerInjections`, un bouton « Tabular review » sous « Nouvelle session » pour les dossiers sous bouclier vert.

## Fonctionnement

- **Lancer** : choix du dossier, du modèle, du nom de la review, des documents Markdown (`.md`) à analyser et de leur regroupement en lignes, puis du fournisseur (Claude ou Codex) et du modèle IA. Le modèle le plus économique (Haiku, Luna…) est proposé par défaut ; un modèle plus puissant déclenche un avertissement sur la consommation de tokens, et une confirmation récapitule le nombre de sessions lancées.
- **Modèles** : liste compacte ; le bouton ⋮ ouvre l'édition (nom, description, questions avec titre, format, consigne et étiquettes autorisées), la duplication et la suppression. Les modèles sont stockés dans `~/.piecemaker/tabular-review/`.
- **Historique** : toutes les reviews des dossiers enregistrés, filtrables par dossier et actualisées tant qu'une review tourne. Chaque review s'ouvre dans un tableau à en-tête et première colonne figés ; un clic sur une cellule affiche la réponse, sa justification (citations) et les documents sources. Export Word ou PDF, relance des lignes en échec, annulation.

Chaque review est un fichier JSON daté (`AA-MM-JJ - Tabular Review <modèle> - <nom>.json`) dans le dossier `Tabular Review/` à la racine du dossier ; les documents analysés y sont copiés dans `docs/`, et les exports sont écrits à côté du JSON.

Les sessions IA sont lancées par le serveur du plugin, sans persistance dans l'historique des sessions, et passent obligatoirement par le proxy d'anonymisation : si celui-ci n'est pas actif, aucune session n'est lancée.

## Installation

Elle est automatique : la commande `piecemaker` appelle cet installateur à chaque exécution. Pour la rejouer à la main, avec Node 22 ou plus récent et les dépendances de l'application installées, depuis `plugins/piecemaker-tabular-review/` :

```sh
node install.mjs /chemin/vers/piecemaker-droit-francais
```

Le client et le serveur sont compilés avec l'esbuild de l'application, puis `dist/`, le manifeste, l'icône et le lanceur sont copiés dans le répertoire de plugins, avec priorité à `CLOUDCLI_HOME`. Le secret d'accès au serveur du plugin est conservé d'une installation à l'autre dans `plugins.json`.

## Validation

Depuis la racine de l'application :

```sh
npx tsc -p plugins/piecemaker-tabular-review
node plugins/piecemaker-tabular-review/build.mjs
cd plugins/piecemaker-tabular-review && npx vitest run
```
