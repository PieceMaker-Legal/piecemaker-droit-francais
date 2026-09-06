# MCP PieceMaker — copie mécanique

Copie mécanique du dossier `mcp/` du dépôt PieceMaker-Installer : le point
d'entrée du serveur MCP `piecemaker` (`piecemaker/server.mjs`), qui expose
les outils `chronologie`, `graphe_question`, `graphe_construire`,
`graphe_etat` et `conversion` en pilotant `installer/bin/piecemaker.mjs`.

- Source : https://github.com/PieceMaker-Legal/PieceMaker-Installer, commit
  `1c6d69b41f2f961fb196d38e75b51136562848eb` (2026-09-02).
- Aucun `require`/`import` interne réécrit : `REPO_ROOT` (calculé deux
  niveaux au-dessus de ce fichier) résout vers `server/piecemaker/vendor/`,
  où `installer/bin/piecemaker.mjs` est désormais vendorisé au même niveau.
- Enregistré comme serveur MCP `piecemaker` (portée utilisateur) par l'étape
  `installer/steps/12-mcp-piecemaker.mjs`, rejouée par
  `scripts/piecemaker/cli/`.

Aucune donnée utilisateur, aucun dossier, aucun document juridique réel.
