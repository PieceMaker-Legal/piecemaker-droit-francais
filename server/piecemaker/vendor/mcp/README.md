# MCP PieceMaker

Point d'entrée du serveur MCP `piecemaker` (`piecemaker/server.mjs`), qui expose
deux outils :

- `conversion`, en pilotant `installer/bin/piecemaker.mjs` ;
- `sql`, SQL libre sur la base PieceMaker, via la route locale
  `POST /api/piecemaker/local/sql` du serveur applicatif (`runSql` dans
  `installer/lib/conversion-client.mjs`). Le répertoire courant de la session
  est joint à chaque appel.

- `REPO_ROOT`, calculé deux niveaux au-dessus de ce fichier, résout vers
  `server/piecemaker/vendor/`, où vit `installer/bin/piecemaker.mjs`.
- Enregistré comme serveur MCP `piecemaker` (portée utilisateur) par l'étape
  `installer/steps/12-mcp-piecemaker.mjs`, rejouée par
  `scripts/piecemaker/cli/`, et déclaré dans chaque dossier pour Codex, Vibe,
  Cursor, OpenCode et Grok par `server/piecemaker/mcp-declaration.ts`.

Aucune donnée utilisateur, aucun dossier, aucun document juridique réel.
