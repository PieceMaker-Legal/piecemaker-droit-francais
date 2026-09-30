# MCP PieceMaker

Point d'entrée du serveur MCP `piecemaker` (`piecemaker/server.mjs`), qui expose
en pilotant `installer/bin/piecemaker.mjs` :

- `conversion` — `piecemaker conversion --json` ;
- `rechercher_personne` — `piecemaker personne --json [recherche]`, fiche
  complète d'une personne ou d'une autre fiche du dossier, sans les pièces ;
- `modifier_personne` — `piecemaker personne --json <code|nom> --champs <json>`.

- `REPO_ROOT`, calculé deux niveaux au-dessus de ce fichier, résout vers
  `server/piecemaker/vendor/`, où vit `installer/bin/piecemaker.mjs`.
- Enregistré comme serveur MCP `piecemaker` (portée utilisateur) pour Claude
  Code, Codex et Mistral Vibe par l'étape `installer/steps/12-mcp-piecemaker.mjs`,
  rejouée par `scripts/piecemaker/cli/`.

Aucune donnée utilisateur, aucun dossier, aucun document juridique réel.
