# Template « chronologie »

Une frise des événements du dossier. Les événements ne sont pas écrits dans la page : un script les met en forme dans `data.js`, que la page charge.

1. Rassemblez les événements dans un fichier du dossier, au format de `references/format.md` (lisez-le : `ArtifactTemplates read type_url=piecemaker://template/chronologie path=references/format.md`).
2. Lancez le script : `ArtifactTemplates run type_url=piecemaker://template/chronologie script=build args=["<fichier>"] url=<artifact>`. Il écrit `Artifacts/chronologie/data.js` et rend la commande de publication.
3. Publiez : `Artifact publish url=<artifact> files={"data.js": "Artifacts/chronologie/data.js"}`.

Pour mettre la frise à jour, relancez le script puis republiez `data.js` : la page ne change pas.
