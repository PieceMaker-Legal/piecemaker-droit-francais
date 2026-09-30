# Tabular Review PieceMaker

Plugin CloudCLI d'analyse tabulaire de documents : une ligne par document (ou groupe de documents), une colonne par question d'un modèle, une session IA éphémère par ligne. Il occupe le slot `tab` et ajoute, par `piecemakerInjections`, un bouton « Tabular review » sous « Nouvelle session » pour les dossiers sous bouclier vert.

## Fonctionnement

- **Lancer** : choix du dossier, du modèle, du nom de la review, des documents Markdown (`.md`) à analyser et de leur regroupement en lignes, puis du fournisseur (Claude ou Codex) et du modèle IA. Le modèle le plus économique (Haiku, Luna…) est proposé par défaut ; un modèle plus puissant déclenche un avertissement sur la consommation de tokens, et une confirmation récapitule le nombre de sessions lancées.
- **Modèles** : liste compacte ; le bouton ⋮ ouvre l'édition (nom, description, questions avec titre, format, consigne et étiquettes autorisées), la duplication et la suppression. Les modèles sont stockés dans `~/.piecemaker/tabular-review/`.
- **Historique** : toutes les reviews des dossiers enregistrés, filtrables par dossier et par catégorie (analyse de documents, recherche juridique) et actualisées tant qu'une review tourne. Chaque review s'ouvre dans un tableau à en-tête et première colonne figés ; un clic sur une cellule affiche la réponse, sa justification (citations) et les documents sources. Export Word ou PDF, relance des lignes en échec, annulation.
- **Sessions ciblées** : le bouton ▶ d'un en-tête de colonne lance une session par ligne dont la cellule de cette colonne est vide ; le panneau de détail d'une cellule lance une session pour cette seule cellule (ou la relance, en remplaçant la réponse, après confirmation). Dans tous les cas, y compris au lancement et à la relance, une session ne pose que les questions dont la cellule est vide (absente ou « Non traité ») ; si toutes les cellules visées sont déjà remplies, aucune session n'est ouverte.
- **Citations vérifiées** : chaque réponse doit être étayée par au moins une citation littérale (sauf « Non trouvé »). Chaque extrait est recherché dans le document source avec la même tolérance que le vérifieur de PieceMaker : texte exact, puis espaces et casse, puis ponctuation, et segments séparés par « … ». Si une citation manque ou n'est pas retrouvée, une demande de correction est envoyée dans la même session. Elle ne vise que les colonnes en défaut et peut être renvoyée jusqu'à 3 fois de suite. Au-delà, la boucle s'arrête pour éviter la cascade, et la cellule garde sa réponse avec la mention « extrait non retrouvé » ou « sans citation ». Avec Claude, la session reste ouverte en mode multi-tours (`--input-format stream-json`), sans persistance. Avec Codex, chaque relance rejoue la conversation dans une nouvelle exécution éphémère. Les liens [1], [2]… sont affichés directement dans la cellule : un clic ouvre le document source avec l'extrait surligné, plus un lien Légifrance pour les décisions. Le panneau de détail et les exports Word et PDF reprennent les citations.

## Recherche juridique

L'onglet **Recherche juridique** construit une review à partir d'une recherche jurisprudentielle Légifrance au lieu des documents du dossier : une ligne par décision, une colonne par question annoncée.

- **Filtres** : ceux du MCP Légifrance (`PieceMaker-Legal/mcp-legifrance`), avec la même syntaxe de requête (guillemets, `ET` prioritaire sur `OU`, parenthèses, références d'articles normalisées) et les mêmes facettes : Cour de cassation (matière obligatoire, traduite en chambres, formations transversales toujours incluses ; publication au Bulletin), cours d'appel (sièges), Conseil d'État et cours administratives d'appel (villes ; publication au recueil Lebon), première instance (familles de juridictions obligatoires, étendues aux libellés réels de la facette ; mots reliés par `OU` sans opérateur explicite), dates de décision.
- **Téléchargement** : le serveur du plugin appelle directement l'API Légifrance (PISTE) avec les identifiants du MCP (`~/.config/mcp-legifrance/.env`, ou `LEGIFRANCE_CLIENT_ID` / `LEGIFRANCE_CLIENT_SECRET` / `LEGIFRANCE_ENV`). Le total cumulé est contrôlé avant tout téléchargement : au-delà de 500 résultats, la recherche est refusée, comme dans le MCP. Sinon, toutes les pages de résultats puis le texte intégral de chaque décision sont téléchargés (5 en parallèle, reprises sur 429 et 5xx, second passage pour les échecs).
- **Panneau** : décisions par ordre d'importance (formation solennelle, puis publication au Bulletin ou au Lebon, tables, inédits, puis cours d'appel et première instance ; à rang égal, pertinence Légifrance puis date), par pages de 10 avec titrage et résumé officiels (ou un extrait à défaut), lecture à la demande de la partie retenue ou du texte intégral, flèches du clavier pour tourner les pages.
- **Dispositif uniquement** (coché par défaut) : Légifrance ne découpe pas les décisions en zones (seule l'API Judilibre le fait). La partie où le juge statue est donc repérée par ses formules : « Réponse de la Cour », « Mais attendu que », visas et « En statuant ainsi » pour la Cour de cassation (faits, énoncé des moyens, griefs et moyens annexes écartés) ; « Motifs de la décision », « Sur ce », « Considérant » pour les autres juridictions ; puis « Par ces motifs » ou « Décide ». La requête est réévaluée sur cette partie seule : les décisions où ses termes n'y figurent pas sont écartées (consultables à part). Une décision dont les motifs ne sont pas repérés est conservée et signalée (dispositif seul ou texte intégral). Seule la partie retenue est écrite dans `Tabular Review/docs/` et transmise à l'IA.
- **Lancement** : les questions se saisissent librement ou partent d'un modèle ; la review porte la catégorie « Recherche juridique », affichée en étiquette et filtrable dans l'historique, ainsi que la requête et les critères, repris dans les exports.

Les résultats de recherche sont conservés sept jours dans `~/.piecemaker/tabular-review/research/`.

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
