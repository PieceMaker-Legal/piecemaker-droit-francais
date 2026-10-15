# MCP PieceMaker

Deux serveurs stdio embarqués. `mcp-declaration.ts` déclare `legifrance`
dans chaque dossier et **retire** `piecemaker` (remplacé par le skill
`Skill-PieceMaker` / `scripts/pm`). L’étape `12-mcp-piecemaker` retire
l’enregistrement Claude en portée utilisateur.

- `piecemaker` (`piecemaker/server.mjs`) — conservé pour un client MCP
  sans shell ; plus déclaré par défaut. `conversion`, `sql`, `afficher`,
  `chronologie`, `tabular_review`.
- `legifrance` (`legifrance/server.mjs`) — runtime Python vendu
  (`mcp_stdio_server.py`), venv isolé dans `~/.piecemaker/mcp-legifrance/`.
  Identifiants PISTE : `~/.config/mcp-legifrance/.env`. Déclaré aussi dans
  `.mcp.json` du dossier (Claude).

`REPO_ROOT` du serveur `piecemaker`, calculé deux niveaux au-dessus de
`piecemaker/server.mjs`, résout vers `server/piecemaker/vendor/`.

Aucune donnée utilisateur, aucun dossier, aucun document juridique réel.
