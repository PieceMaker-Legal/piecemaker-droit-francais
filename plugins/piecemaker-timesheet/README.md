# Timesheet PieceMaker

Plugin CloudCLI qui affiche le temps passé et les conclusions des sessions, par dossier. Il occupe le slot `tab` et lit les entrées via la route `/api/piecemaker/timesheet` servie par le module `server/piecemaker/timesheet` de l'application. Sur CloudCLI sans cette extension, l'onglet reste vide.

## Installation

Comme tous les plugins PieceMaker : compilé et installé par la chaîne commune `plugins/toolchain`, embarqué dans l'application Electron et réinstallé à chaque démarrage si besoin. Depuis le dépôt : `npm run plugins`. Voir `plugins.md` à la racine.

## Validation

```sh
npm install --ignore-scripts
npm test
```
