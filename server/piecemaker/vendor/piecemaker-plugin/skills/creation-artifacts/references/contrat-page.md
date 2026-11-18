# Contrat d'une page d'artifact

## Enveloppe

- Un seul fichier `.html` qui commence par `<!doctype html>`, `<meta charset="utf-8">` et `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- `<title>` : un nom de deux à quatre mots (« Chronologie du litige », « Suivi des pièces »). C'est le titre de la carte dans la galerie ; l'explication va dans `description`, une phrase.
- `icon` : un mot générique (`chart`, `calendar`, `document`, `slides`, `checklist`, `timeline`, `map`, `table`), jamais un nom de marque.
- 16 Mo au plus pour la page, `data:` compris.

## Couleurs et thèmes

- Toutes les couleurs sont des variables sur `:root` (`--bg`, `--fg`, `--muted`, `--line`, `--accent`, `--card`).
- Thème sombre redéfini deux fois : sous `@media (prefers-color-scheme: dark)` gardé par `:root:not([data-theme="light"])`, et sous `:root[data-theme="dark"]`. L'onglet pose `data-theme` sur `<html>` selon le thème de PieceMaker.
- `body` a un fond explicite (`background: var(--bg)`).
- Contraste suffisant dans les deux thèmes ; jamais d'information portée par la couleur seule.

## Mise en page

- Fonctionne à 360 px de large : gouttière de 16 px, aucun défilement horizontal, tableaux larges dans un conteneur `overflow-x: auto`.
- Texte de 15 à 17 px, interligne 1,5. Une colonne de lecture de 760 px au plus pour un texte.
- Pour une page à imprimer, une feuille `@media print`.

## Isolement

La page tourne dans une iframe isolée, sans accès au jeton de PieceMaker ni au reste de l'application :

- **Aucune requête réseau** : `fetch`, `XMLHttpRequest`, WebSocket sont bloqués (`connect-src 'none'`), même vers les fichiers publiés de l'artifact. Toute donnée est dans la page, dans un script publié (`data.js` chargé par `<script src>`) ou dans sa base (`window.artifact.db`).
- Scripts externes permis seulement depuis `cdnjs.cloudflare.com` (préféré), `cdn.jsdelivr.net/npm/`, `unpkg.com`, `cdn.tailwindcss.com`, `code.jquery.com`, avec une version exacte (`chart.js@4.4.1`, jamais `@4` ni sans version). Feuilles de style externes : Google Fonts seulement. Préfère tout mettre dans la page : le dossier peut être ouvert hors ligne.
- Images : fichiers publiés, assets (`Artifact publish url=… asset=true file_path=…`, puis l'`url` rendue telle quelle) ou `data:`. Pas d'image distante.
- Pas de `localStorage` pour un état qui doit durer : il reste dans ce navigateur. Il sert au confort (onglet retenu, filtre). Enveloppe chaque accès dans `try/catch`.

## Contenu juridique

- Cite les pièces par leur numéro de bordereau et leur titre, les textes par leur référence (article, code, version), les décisions par juridiction, date et numéro.
- Distingue les faits établis par une pièce, les prémisses discutées et ton analyse.
- Date la page (« à jour au … ») quand elle reflète l'état du dossier.

## Données et graphiques

- Un graphique doit montrer une chose, avec un titre qui la dit. Axes nommés, unités, source sous le graphique.
- Les nombres viennent du dossier (index, tabular review, base) ; ne les invente pas. Ce qui manque s'affiche comme manquant.
