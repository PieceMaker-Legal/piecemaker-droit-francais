---
name: electron-cloudcli
description: À utiliser pour toute création, modification ou revue du packaging Electron, de l'installation, des mises à jour, des composants embarqués et de la désinstallation de PieceMaker sur Windows ou macOS.
---

# Electron : priorité au fonctionnement CloudCLI

## Examiner avant de modifier

Lire les instructions du dépôt, `docs/upstream-cloudcli.md`, `docs/installation-app-electron.md` et, pour la livraison continue, `docs/maj-continue.md`. Comparer les fichiers concernés à `upstream/main` avec `git show` et `git diff`, sans lire de fichier `.env`. Identifier les points d'extension existants avant de proposer un mécanisme.

Le fonctionnement CloudCLI est la référence prioritaire : réutiliser Electron, son Node embarqué, electron-builder, NSIS et le contrôleur de serveur existants. Insérer les composants PieceMaker dans ce cycle. Ne pas créer un installateur, un gestionnaire de mise à jour, une désinstallation ou un serveur parallèle quand une extension du mécanisme existant suffit.

## Respecter le fork

Les ajouts appartiennent à `desktop-bootstrap/`, `scripts/piecemaker/` et aux modules PieceMaker. Les fichiers CloudCLI restent inchangés sauf substitutions de marque ou d'isolation déjà autorisées. Utiliser les hooks officiels et la préparation du paquet ; ne pas modifier un prototype upstream lorsqu'un raccord documenté suffit. Justifier toute limitation upstream constatée, sans inventer une API d'extension.

## Un propriétaire par ressource

Sous Windows, NSIS possède l'installation et la désinstallation de l'application. Le bouton interne délègue au désinstalleur enregistré. Un hook de nettoyage PieceMaker distingue désinstallation explicite et mise à jour : ne jamais purger les composants ou les données pendant le retrait d'une ancienne version.

Les composants Python de l'application partagent un environnement versionné, construit et vérifié en CI, sauf incompatibilité démontrée. Les lanceurs réutilisent cet interpréteur ; aucune installation pip au premier appel pour un environnement géré. Les modèles restent séparés des bibliothèques. Ne pas rediriger les profils ou les installations personnels des fournisseurs.

Chaque composant doit avoir un chemin privé, une version, une preuve de propriété et une règle de conservation. Ne pas supprimer un modèle partagé ou un certificat à partir de son seul nom. Préserver les dossiers juridiques et les données que l'interface annonce conserver. Rapporter les échecs de suppression.

## Vérifier avant livraison

Tester les défauts reproduits et les points de raccord ; contrôler les imports et les chemins du paquet. Utiliser le parcours Windows jetable déjà présent pour installation réelle, premier lancement, conversion, session, mise à jour, désinstallation et réinstallation. Une résolution pip ou un serveur `/health` ne valide pas ce parcours.

Sur le Mac de développement, ne pas lancer de build Vite pour vérifier une modification et ne pas arrêter le serveur utilisateur. Distinguer les tests effectivement exécutés de ceux qui nécessitent Windows. Ne pas publier, pousser ou choisir un nouveau numéro de version sans instruction correspondante. Lire et justifier les diffs, puis commiter le travail terminé.
