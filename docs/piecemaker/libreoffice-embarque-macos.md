# LibreOffice embarqué dans PieceMaker sur macOS

Le module existant `server/piecemaker/vendor/installer/steps/10-libreoffice.mjs`
prépare maintenant aussi les paquets officiels macOS Apple Silicon et Intel.
La version et les empreintes SHA-256 sont épinglées par architecture, à partir
du [manifeste Homebrew](https://github.com/Homebrew/homebrew-cask/blob/main/Casks/l/libreoffice.rb).
Le DMG est monté en lecture seule et le bundle complet est copié avec `ditto`.
Les droits d'exécution, liens internes et notices de LibreOffice sont conservés.
Le montage est détaché avant le retrait de son répertoire temporaire.

Le moteur est inclus dans
`PieceMaker.app/Contents/Resources/libreoffice/LibreOffice.app` via les ressources
electron-builder existantes. Le `.app` externe conserve son cycle d'installation
et de désinstallation ; aucun Homebrew ni second programme système n'est
installé chez l'utilisateur. Les profils LibreOffice personnels ne sont pas utilisés
par la conversion, qui garde son profil temporaire isolé.

`findSoffice()` reste l'unique détection, partagée avec le tamponnage et l'étape
d'installation. Après une éventuelle surcharge explicite `SOFFICE_PATH`, elle
cherche le moteur dans les ressources de l'application courante avant
`/Applications/LibreOffice.app`. La vérification du paquet exige le moteur embarqué.

Le script de contrôle natif est commun à Windows et macOS :
`scripts/piecemaker/verify-office.mjs`. Il prépare une arborescence d'application,
déplace un Node natif dans son emplacement d'exécutable et teste les conversions
avec `SOFFICE_PATH` vide. Des fichiers DOCX et XLSX fictifs passent par les vraies
routes de tamponnage ; pages, image du tampon, numéros et originaux sont contrôlés.
Les liens du bundle macOS doivent rester dans l'application.

Le workflow `piecemaker-libreoffice-macos.yml` exécute ces vérifications sur
`macos-15` (Apple Silicon) et `macos-15-intel`, puis sert de préalable au workflow
de construction macOS existant. Il ne publie pas de release. Les paquets de
production gardent la chaîne de signature et de distribution existante.

Les tests locaux de sélection d'architecture et de packaging passent sur Windows.
Les contrôles natifs macOS restent en attente au moment du commit ; ils ne
constituent pas encore une validation d'un `.app` final signé et installé.

Le test de durée de vie du lanceur Node Windows utilise désormais un PID annoncé
par son propre processus témoin. Il ne dépend plus du comptage PowerShell qui
échouait sur le runner ; il doit toujours constater l'arrêt de l'enfant quand
le lanceur est arrêté.
