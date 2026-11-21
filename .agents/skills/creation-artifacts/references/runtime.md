# Runtime d'une page : `window.artifact`

PieceMaker injecte un petit runtime en tête de chaque page affichée dans l'onglet Artifacts. Si le fichier est ouvert directement, `window.artifact` n'existe pas : teste-le et affiche un message plutôt que de planter.

## Base partagée (`capabilities={"db": {}}`)

Mêmes règles qu'`ArtifactData` : collections et documents, `version` incrémentée à chaque écriture, `ifVersion` requis pour écrire un document existant.

```js
const db = window.artifact?.db;
await db.get('items', 'i1');                          // {id, path, data, version, updatedAt}, null s'il n'existe pas
await db.list('items', { limit: 100 });               // {documents, next_cursor}
await db.query('items', { where: [['done', '==', false]], order_by: { field: 'order' } });
await db.set('items', 'i1', { text: 'Obtenir le Kbis', done: false });     // création
await db.update('items', 'i1', { done: true }, { ifVersion: 1 });           // fusion
await db.strReplace('notes', 'n1', 'texte', 'ancien', 'nouveau', { ifVersion: 2 });
await db.delete('items', 'i1', { ifVersion: 2 });
await db.batch([{ op: 'set', collection: 'items', doc_id: 'i2', data: { text: '…' } }]);
```

Une écriture refusée (conflit de version) lève une erreur : relis le document et recommence.

L'événement `artifact:data` part quand la base a changé hors de la page (l'agent a écrit par `ArtifactData`) : relis ce que tu affiches.

```js
window.addEventListener('artifact:data', refresh);
```

## Thème

`window.artifact.theme` vaut `light` ou `dark` ; l'onglet pose aussi `data-theme` sur `<html>` et envoie `artifact:theme` quand il change. Les variables CSS du contrat suffisent en général.

## Fichier à enregistrer

```js
await window.artifact.download('suivi.csv', csv, 'text/csv');
```

L'onglet propose le fichier à l'avocat. Rien n'est écrit dans le dossier.
