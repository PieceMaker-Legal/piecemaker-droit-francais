# MCP PieceMaker

Deux serveurs stdio embarqués, déclarés dans chaque dossier par
`server/piecemaker/mcp-declaration.ts` :

- `piecemaker` (`piecemaker/server.mjs`) — `conversion` (Markdown + scan PII,
  via `installer/bin/piecemaker.mjs`) et `sql` (base du dossier, via
  `POST /api/piecemaker/local/sql`). Enregistré aussi en portée utilisateur
  Claude par l'étape `12-mcp-piecemaker`.
- `legifrance` (`legifrance/server.mjs`) — runtime Python vendu
  (`mcp_stdio_server.py`), venv isolé dans `~/.piecemaker/mcp-legifrance/`.
  Identifiants PISTE : `~/.config/mcp-legifrance/.env`. Déclaré aussi dans
  `.mcp.json` du dossier (Claude).

`REPO_ROOT` du serveur `piecemaker`, calculé deux niveaux au-dessus de
`piecemaker/server.mjs`, résout vers `server/piecemaker/vendor/`.

Aucune donnée utilisateur, aucun dossier, aucun document juridique réel.
