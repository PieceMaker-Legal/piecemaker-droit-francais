# Tabular Review PieceMaker

Plugin CloudCLI d'analyse tabulaire de documents : une ligne par document (ou groupe de documents), une colonne par question d'un modèle, une session IA éphémère par ligne. Il occupe le slot `tab` et ajoute, par `piecemakerInjections`, un bouton « Tabular review » sous « Nouvelle session » pour les dossiers sous bouclier vert.

## Fonctionnement

- **Lancer** : choix du dossier, du modèle, du nom de la review, des documents Markdown (`.md`) à analyser et de leur regroupement en lignes, puis du fournisseur (Claude ou Codex) et du modèle IA. Le modèle le plus économique (Haiku, Luna…) est proposé par défaut ; un modèle plus puissant déclenche un avertissement sur la consommation de tokens, et une confirmation récapitule le nombre de sessions lancées.
- **Modèles** : liste compacte ; le bouton ⋮ ouvre l'édition (nom, description, questions avec titre, format, consigne et étiquettes autorisées), la duplication et la suppression. Les modèles sont stockés dans `~/.piecemaker/tabular-review/`.
- **Historique** : toutes les reviews des dossiers enregistrés, filtrables par dossier et actualisées tant qu'une review tourne. Chaque review s'ouvre dans un tableau à en-tête et première colonne figés ; un clic sur une cellule affiche la réponse, sa justification (citations) et les documents sources. Export Word ou PDF, relance des lignes en échec, annulation.
- **Sessions ciblées** : le bouton ▶ d'un en-tête de colonne lance une session par ligne dont la cellule de cette colonne est vide ; le panneau de détail d'une cellule lance une session pour cette seule cellule (ou la relance, en remplaçant la réponse, après confirmation). Dans tous les cas, y compris au lancement et à la relance, une session ne pose que les questions dont la cellule est vide (absente ou « Non traité ») ; si toutes les cellules visées sont déjà remplies, aucune session n'est ouverte.

Chaque review est un fichier JSON daté (`AA-MM-JJ - Tabular Review <modèle> - <nom>.json`) dans le dossier `Tabular Review/` à la racine du dossier ; les documents analysés y sont copiés dans `docs/`, et les exports sont écrits à côté du JSON.

Les sessions IA sont lancées par le serveur du plugin, sans persistance dans l'historique des sessions, et passent obligatoirement par le proxy d'anonymisation : si celui-ci n'est pas actif, aucune session n'est lancée.

## Installation

Comme tous les plugins PieceMaker : compilé et installé par la chaîne commune `plugins/toolchain`, embarqué dans l'application Electron et réinstallé à chaque démarrage si besoin. Depuis le dépôt : `npm run plugins`. Voir `plugins.md` à la racine.

## Validation

Depuis la racine de l'application :

```sh
npx tsc -p plugins/piecemaker-tabular-review
node plugins/toolchain/cli.mjs --check
cd plugins/piecemaker-tabular-review && npx vitest run
```
