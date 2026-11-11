# Index OKF du dossier

L'index du dossier suit Open Knowledge Format 0.2, avec les relations typées et les atomes d'OKF-Legal. Le format n'est pas réinventé : frontmatter YAML, `type` obligatoire, `generated`, identifiants bundle-relatifs, `index.md` avec `okf_version`.

## Périmètre

- `.piecemaker/okf/` : une fiche Markdown par document, plus `index.md`.
- SQLite garde les personnes, les mappings, les mentions et l'outil `sql`. Les nœuds `document` y restent l'ancre des mentions.
- OKF est la source des types, des liens entre documents et des atomes.

## Types

Le type d'une fiche est le dossier de premier niveau de `.piecemaker/arborescence.json`. Sans arborescence, la classification par défaut s'applique. Aucun autre type n'existe. Un document hors arborescence reçoit `Non classé` ; la vérification le signale.

Le graphe ne montre que certains types : `['Pièces']` par défaut, ou `typesGraphe` dans `.piecemaker/okf.json`. Les liens n'existent qu'entre documents de ces types.

## Production, sans token

1. Le scan GLiNER remplit SQLite.
2. `buildBundle` écrit une fiche par document : titre, nature, date, atomes (citation de chaque entité).
3. Le scan pose `refers-to` quand une phrase du Markdown converti contient la date et la nature d'un seul autre document.

La reconstruction a lieu après un scan, après un renommage (les cibles suivent) et à chaque lecture. Un fichier n'est réécrit que si son contenu change. Les liens ajoutés par l'agent et les liens du scan écartés sont conservés.

L'IA n'intervient qu'à la demande, par `pm okf link`. Le serveur refuse une citation absente du document source.

## Relations

`amends`, `responds-to`, `refers-to`, dans le frontmatter : `relations: { <relation>: [{ target, citation, origin, dismissed? }] }`. `origin` vaut `piecemaker/gliner` ou `piecemaker/agent`.

## Vérification

`pm okf verify`, ou le bouton Vérifier de l'onglet Index. Contrôles : frontmatter, type, document présent, fiche alignée sur son document, relation connue, cible présente et de type graphe, citation des liens et des atomes retrouvée mot pour mot, document sans fiche, `index.md`.

## Interface

Onglet Index du plugin `piecemaker-dossier` : tableau avec colonne Liens (survol : citation) et bascule Graphe (cytoscape, clic sur un nœud : fiche du document).

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Format, lecture, écriture | `server/piecemaker/okf/bundle.ts` |
| Construction depuis le scan | `server/piecemaker/okf/build.ts` |
| Vérification | `server/piecemaker/okf/verify.ts` |
| Liens à la demande | `server/piecemaker/okf/links.ts` |
| Routes `/api/piecemaker/okf` et locale | `server/piecemaker/okf/index.ts` |
| Commande `pm okf` | `server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/pm.mjs` |
| Tableau et graphe | `plugins/piecemaker-dossier/src/okf.ts` |
