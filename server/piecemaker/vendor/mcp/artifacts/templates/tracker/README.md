# Template « tracker »

Une liste dont les lignes vivent dans la base de l'artifact (capability `db`), pas dans la page : l'avocat ajoute et coche des lignes dans l'onglet, l'agent les lit et les écrit par `ArtifactData`, sans republier la page.

- Collection : `items`. Document : `{ "text": string, "done": boolean, "due"?: "AAAA-MM-JJ", "owner"?: string, "order": number }`.
- Ajouter une ligne : `ArtifactData set url=<artifact> collection=items doc_id=<id> data={...}`.
- Cocher : `ArtifactData update ... data={"done": true} if_version=<version lue>`.
- Changez les libellés et les champs affichés dans la page ; gardez `window.artifact.db` pour lire et écrire.
