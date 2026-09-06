# Installer PieceMaker — copie mécanique

Copie mécanique du dossier `installer/` du dépôt PieceMaker-Installer, socle
technique (composants Python GLiNER/Graphify, conversion, chronologie et
graphe juridique, orchestration Légifrance/PISTE, enregistrement MCP)
absorbé directement dans ce dépôt.

- Source : https://github.com/PieceMaker-Legal/PieceMaker-Installer, commit
  `1c6d69b41f2f961fb196d38e75b51136562848eb` (2026-09-02).
- Aucun `require`/`import` interne réécrit : `REPO_ROOT` (calculé depuis
  `installer/lib/platform.mjs`, deux niveaux au-dessus de lui-même) résout
  vers `server/piecemaker/vendor/`, où `websocket-server/` et
  `piecemaker-plugin/` sont déjà vendorisés.
- Seules les étapes `01-prerequis`, `03-python-gliner`, `03b-python-graphify`,
  `04-conversion-md`, `12-mcp-piecemaker`, `07-legifrance` sont rejouées par
  `scripts/piecemaker/cli/`. Les autres étapes sont présentes pour fidélité
  de copie mais ne sont invoquées par rien dans ce dépôt.

Aucune donnée utilisateur, aucun dossier, aucun document juridique réel.
