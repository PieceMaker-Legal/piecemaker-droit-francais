# Features (MCP `features`)

Le MCP `features` donne à l'agent les fonctions de PieceMaker par trois outils. Une **feature** est un onglet du dossier avec ses skills et ses commandes `pm`. L'agent ne lit le skill que de la feature qu'il utilise : la découverte est progressive.

```mermaid
flowchart LR
  A[Agent] -->|Feature quickstart / read| C["herisson.json › catalogue"]
  A -->|Feature run| P["pm.mjs (execFile, sans shell)"]
  A -->|Feature open / close| T[pm tab afficher / fermer]
  A -->|FeatureData| D[".piecemaker/features/data/"]
  A -->|FeatureComments| M[".piecemaker/features/comments/"]
  L[Avocat : pastille « Commenter »] -->|POST /api/piecemaker/feature-comments| M
```

## Outils

| Outil | Actions | Rôle |
|---|---|---|
| `Feature` | `quickstart`, `list`, `read`, `run`, `open`, `close` | catalogue, skills, commandes `pm`, onglets |
| `FeatureData` | `get`, `list`, `query`, `set`, `update`, `str_replace`, `delete`, `batch` | base de données par feature, API de type Firestore |
| `FeatureComments` | `read`, `reply`, `resolve` | fils de commentaires de l'avocat, ancrés sur un élément ciblé |

- `quickstart` est le premier appel d'un travail nouveau. Il prend `intent` (`case`, `index`, `review`, `stamp`, `reasoning`, `deadlines`, `catala`, `draft`, `other`) et renvoie la feature, ses skills, ses commandes, un extrait de `pm check` et les premiers appels.
- `run` prend `name`, `command` et `args`. Le catalogue traduit les noms anglais en argv `pm`. `pm` garde ses noms français.
- `read projects` liste aussi les fichiers du dossier, Word en tête, hors fichiers cachés et `.piecemaker/`.

## Catalogue

Le catalogue est la clé `catalogue` de `server/piecemaker/vendor/piecemaker-plugin/herisson.json`. Chaque entrée porte `nom`, `titre`, `description`, `volet`, `skills`, `demarrage` et `commandes`.

Une commande est `{nom, pm, role, parametres}`. Valeurs d'un paramètre :

| Valeur | Sens |
|---|---|
| `"#"` | positionnel requis |
| `"#?"` | positionnel facultatif |
| `"--option"` | option `pm` ; `true` donne l'option seule, un objet est passé en JSON |

`parametres` au niveau de la feature sert de défaut à ses commandes. `pm catala exec` n'est pas exposé.

## Données

```
.piecemaker/features/data/<feature>/<collection>/<doc>.json   {data, version, updatedAt}
.piecemaker/features/comments/<feature>.json                  {threads: [{id, anchor, messages, resolved}]}
```

- Écritures atomiques et verrouillées ; `if_version` contre l'écriture concurrente ; `batch` tout ou rien.
- La feature `case` lit en plus `okf/…`, `deadlines/<nom>` et `memories/<nom>`, en lecture seule.
- Le Hérisson (entrée `features`) refuse Edit, Write et le shell sur `.piecemaker/features/`.

## Commentaires ancrés

1. L'avocat cible un élément d'un volet ; une pastille apparaît au-dessus du chat.
2. Il clique 💬 « Commenter » sur la pastille.
3. À l'envoi, le client crée l'identifiant du fil, l'ajoute à la ligne de la pastille (`commentaire <id> : FeatureComments read <feature>`) et poste le fil.
4. La route `POST /api/piecemaker/feature-comments?projectId=…` écrit le fil (`server/piecemaker/feature-comments.ts`).
5. L'agent lit le fil par `FeatureComments read`, répond par `reply`, ferme par `resolve`.

Feature du fil : `catala` pour le volet Catala, `case` sinon.

## Hérisson

Le hook PostToolUse traite `mcp__features__Feature` avec `action: run` comme la commande `pm …` équivalente. Les matchers Claude (`hooks/hooks.json`) et Codex (`codex-skills.mjs`) incluent l'outil MCP.

## Déclaration

`BUNDLED_SERVERS` de `server/piecemaker/mcp-declaration.ts` déclare `features` dans chaque dossier, comme `legifrance` (`.mcp.json`, `.codex/config.toml`, `.vibe/config.toml`). Le serveur MCP prend le dossier courant comme racine.

## Limites connues

- Le hook Vibe (`vibe-hook.mjs`) ne couvre pas les outils MCP.
- `guard-ontologie` ne voit pas `Feature run` : `pm` garde ses propres contrôles.
- À vérifier en essai réel : dossier courant du MCP sous Codex et Vibe, chargement par le chat Mistral, dépseudonymisation des arguments MCP.

## Fichiers

| Rôle | Fichier |
|---|---|
| Serveur MCP | `server/piecemaker/vendor/mcp/features/server.mjs` |
| Catalogue | `server/piecemaker/vendor/mcp/features/catalogue.mjs` |
| Store | `server/piecemaker/vendor/mcp/features/store.mjs`, `vue-dossier.mjs` |
| Traduction en `pm` | `server/piecemaker/vendor/piecemaker-plugin/scripts/lib/herisson.mjs` (`pmArgv`) |
| Route des commentaires | `server/piecemaker/feature-comments.ts` |
| Pastille « Commenter » | `src/modules/piecemaker-chat-picks/chatPickComposer.ts` |
