# MCP PieceMaker

Point d'entrée du serveur MCP `piecemaker` (`piecemaker/server.mjs`), qui expose
les outils `chronologie`, `graphe_question`, `graphe_construire`, `graphe_etat`
et `conversion` en pilotant `installer/bin/piecemaker.mjs`.

- `REPO_ROOT`, calculé deux niveaux au-dessus de ce fichier, résout vers
  `server/piecemaker/vendor/`, où vit `installer/bin/piecemaker.mjs`.
- Enregistré comme serveur MCP `piecemaker` (portée utilisateur) par l'étape
  `installer/steps/12-mcp-piecemaker.mjs`, rejouée par
  `scripts/piecemaker/cli/`.

Aucune donnée utilisateur, aucun dossier, aucun document juridique réel.
