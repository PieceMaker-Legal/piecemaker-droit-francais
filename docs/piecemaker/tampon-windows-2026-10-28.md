# Vérification du plugin Tampon sous Windows

Le plugin `piecemaker-tampon`, affiché sous le nom Bordereau, ne possède pas
de serveur enfant ni de route RPC propre. Son frontend appelle directement
les routes authentifiées `/api/piecemaker/tampon/*` et
`/api/piecemaker/stamping` du serveur principal. Il n'est donc pas touché par
le défaut du lanceur Node de l'édition Validation.

## Contrôles exécutés

Le test `server/piecemaker/stamping.test.js` monte les vraies routes Express
avec les bibliothèques de l'application Windows installée. Son dossier fictif
et son registre de projets sont isolés ; le tampon et les documents utilisateur
ne sont ni lus ni modifiés. Le serveur de l'utilisateur reste actif.

Le test réussit sur Windows et vérifie :

- absence initiale du tampon (404) et rejet d'une image invalide (400) ;
- sauvegarde PNG puis relecture à l'identique ;
- tamponnage d'un PDF de deux pages, d'un Markdown et d'une image PNG ;
- création de trois PDF dans « Pièces tamponnées », ordre et numéros 1, 2, 3 ;
- image du tampon incorporée au PDF et numéro présent dans son flux de contenu ;
- conservation des deux pages du PDF et des empreintes des trois originaux ;
- relecture du dernier bordereau ; échec par pièce pour un chemin non autorisé ;
- suppression du seul tampon fictif, puis retour à 404.

Ce test est intégré à l'étape des contrats d'installation du workflow Windows.
Aucun défaut n'a été reproduit sur le parcours PDF, image ou texte testé ;
aucune modification du code fonctionnel du plugin n'a été nécessaire.

## Limites de la vérification

Le rendu du canvas, les clics du volet et l'ouverture d'Explorer n'ont pas été
pilotés sur le bureau de l'utilisateur. Le test appelle les routes du plugin
sur un serveur isolé ; il ne remplace pas la vérification visuelle du volet
dans une application installée.

Le tamponnage des formats bureautiques Word, Excel et PowerPoint dépend de
LibreOffice dans `lib/office-to-pdf.cjs`. LibreOffice n'est pas installé sur
le poste vérifié ; ces formats ne sont pas validés ici. Le convertisseur
prévoit une erreur explicite lorsque ce composant manque. Le Python embarqué
de conversion documentaire ne remplace pas ce moteur de rendu PDF.

Le support des anciens tampons JPEG est présent dans le code, mais le parcours
exécuté ici utilise un PNG ; il ne constitue pas une validation JPEG.
