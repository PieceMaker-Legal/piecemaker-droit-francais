# Timesheet PieceMaker

Plugin CloudCLI qui affiche le temps passé et les conclusions des sessions, par dossier. Il occupe le slot `tab` et lit les entrées via la route `/api/piecemaker/timesheet` servie par le module `server/piecemaker/timesheet` de l'application. Sur CloudCLI sans cette extension, l'onglet reste vide.

## Installation

Elle est automatique : la commande `piecemaker` appelle cet installateur à chaque exécution. Pour la rejouer à la main, avec Node 22 ou plus récent, depuis `plugins/piecemaker-timesheet/` :

```sh
node install.mjs /chemin/vers/piecemaker-droit-francais
```

La source TypeScript est compilée avec le TypeScript de l'application, puis `dist/`, le manifeste et l'icône sont copiés dans le répertoire de plugins déterminé par `product.config.json`, avec priorité à `CLOUDCLI_HOME`. Le répertoire cible est remplacé à chaque installation : il ne contient que des fichiers produits ici, jamais un dépôt cloné. Aucun dépôt distant n'est requis.

## Validation

```sh
npm install --ignore-scripts
npm test
```
