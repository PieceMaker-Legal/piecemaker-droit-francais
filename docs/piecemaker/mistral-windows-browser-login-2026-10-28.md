# Connexion Mistral : ouverture du Microsoft Store sous Windows

## Symptôme et environnement

Sur PieceMaker Validation 2.0.54, installateur Windows x64 issu du commit
`86d9a6cf8b124ece75ad4d971b2ff24e4271b7a7`, le clic Paramètres > Mistral >
Se connecter avec Mistral affiche une recherche d'application puis ouvre le
Microsoft Store, au lieu de la page HTTPS de connexion. Ce comportement a été
signalé par le testeur sur le poste Windows installé.

Le serveur répond sur son port de validation 3218 : `/health` annonce
`status: ok` et `version: 2.0.54`. Le journal signalant l'absence de `.env`
n'explique pas cette erreur d'ouverture du navigateur.

## Cause établie dans le code

`src/piecemaker/mistral-sdk/MistralAccountSettings.tsx` préouvrait une fenêtre
avec `window.open('about:blank', '_blank')` avant d'attendre `mistralSdkApi.login()`.
Il essayait ensuite de naviguer cette fenêtre vers l'URL Mistral.

Or `electron/viewHost.js`, dans `configureChildWebContents`, transmet chaque
`window.open` à `openExternalUrl(url)` et renvoie `{ action: 'deny' }`.
`electron/main.js` appelle alors `shell.openExternal(url)`. Aucun popup enfant
n'est créé et le renderer reçoit `null`. La même politique existe pour la
fenêtre principale dans `electron/desktopWindow.js`.

Le seul lien transmis au système était donc `about:blank`. Windows cherche
un gestionnaire pour le protocole `about:`, ce qui correspond au message et
au Store observés. Une fois la réponse du serveur reçue, la condition
`if (popup)` était fausse : l'URL HTTPS Mistral n'était jamais ouverte.

Le serveur de connexion valide déjà l'origine `https://console.mistral.ai`
dans `scripts/piecemaker/mistral-sdk/browser-login.mjs`. La création de la
tentative PKCE et le polling n'ont pas besoin d'être remplacés.

## Correctif sur MAJ-continue

Le bouton attend l'URL du serveur puis appelle une seule fois
`window.open(url, '_blank', 'noopener,noreferrer')`. Aucun `about:blank` n'est
créé et le succès ne dépend plus d'un objet Window retourné par Electron.
La politique d'ouverture externe CloudCLI reste utilisée sans modification.

Le lien manuel « Ouvrir la page de connexion Mistral » reste affiché pendant
la tentative, notamment si un navigateur web bloque l'ouverture asynchrone.
En cas d'échec de création de la tentative, aucune adresse externe n'est ouverte
et l'erreur reste affichée dans les paramètres.

## Vérifications et limites

Deux contrôles locaux exécutent le corps réel du gestionnaire `connect` dans
un contexte isolé avec les API de fenêtre et de connexion simulées :

- URL différée, aucune ouverture avant sa réception, puis ouverture HTTPS unique,
  même lorsque `window.open` renvoie `null` ; conservation de l'URL de secours ;
- échec API : aucune ouverture externe, erreur affichée et bouton libéré.

Les deux échouent sur le code original à cause de l'ouverture immédiate
`about:blank`, puis passent sur le correctif. Exécution avec le Node embarqué
d'Electron ; aucun serveur utilisateur arrêté ou installation modifiée.

Les tests React existants sont adaptés au retour `null` et un test supplémentaire
couvre la réponse différée et les attributs du lien manuel. Leur exécution
Vitest et les contrôles TypeScript nécessitent les dépendances de développement,
absentes de ce poste ; le workflow Windows de validation est le parcours prévu.

Le Store et le navigateur réels n'ont pas été pilotés automatiquement sur le
poste. Après livraison d'un paquet contenant le correctif, vérifier manuellement :
clic du bouton, ouverture du navigateur sur le domaine Mistral, absence du Store,
autorisation du compte, retour au statut connecté, bouton Vérifier la connexion,
puis conversation et appel d'outil. Aucun jeton réel n'est inclus dans ce rapport.

L'EXE déjà installé contient toujours l'ancien frontend. Ce commit source ne
modifie pas automatiquement l'installation locale et ne publie pas de release.
