# Préparation du test Windows Mistral SDK

Le parcours utilise `.github/workflows/piecemaker-windows-validation.yml`, sur `MAJ-continue`. Il produit un installateur signé **PieceMaker Validation**, avec son identité, son port et son profil distincts. Il conserve la version de la branche, sans publication npm ni release publique. `validation-build.json` identifie le commit embarqué.

## Corrections avant fabrication

- PDF.js : détruire la tâche de chargement propriétaire du worker, y compris pendant un chargement interrompu.
- Éditeur : conserver la même arborescence React entre affichage latéral et flottant, pour garder les modifications non enregistrées.
- Citations : rétablir la navigation entre extraits, le lien officiel correspondant et le statut d’un extrait non vérifié.
- Téléphone : ne lire le statut complet qu’une fois disponible.
- Tests : corriger les chemins physiques macOS, le mock du répertoire utilisateur, les mocks de résolution de fichiers et de traduction, le vocabulaire de l’interface et le contexte des tâches en arrière-plan.

Le précédent contrôle Windows trouvait GLiNER absent après une installation déclarée terminée. Une étape partielle renvoie désormais un échec au serveur ; son diagnostic stdout est conservé avec stderr. Les messages de téléchargement restent visibles sans terminal interactif. Le téléchargement GLiNER est limité aux fichiers du checkpoint épinglé.

La présence du modèle ne suffit pas : le parcours CI doit charger le modèle local et exécuter une inférence. Un modèle absent bloque la mise à disposition du paquet.

La CI a également reproduit un arrêt du téléchargement sur une console Windows cp1252 : les pictogrammes du journal causaient une `UnicodeEncodeError`. Le journal remplace maintenant les caractères non représentables, sans interrompre le téléchargement. Un test reproduit cette console sans forcer UTF‑8 dans la CI.

## Contrôles et livrables

Avant le packaging, la CI vérifie les types, les tests frontend, les tests du plugin et les tests SDK des outils, permissions, skills et conversations. Elle construit ensuite les composants et le paquet NSIS.

Sur la machine Windows jetable, elle contrôle le serveur installé, le SDK embarqué et un aller-retour d’outil avec une réponse fictive, l’API des paramètres Mistral sans compte enregistré, le proxy actif, GLiNER avec inférence locale, le premier démarrage, la conservation de session, la désinstallation native et la réinstallation.

Le paquet final contient le `.exe`, ses sommes de contrôle, l’identifiant de commit, les rapports de vérification et `TESTER-WINDOWS.md`. Il n’est publié comme artefact de test qu’après les contrôles. En cas d’échec, les diagnostics sont conservés séparément.

Le dépôt étant public, le paquet est chiffré en AES-256-GCM avec une clé enveloppée par RSA-OAEP avant son dépôt comme artefact. La CI reçoit seulement la clé publique via `WINDOWS_VALIDATION_PACKAGE_PUBLIC_KEY`. La clé privée reste hors du dépôt, sur le Mac de test. Aucun installateur utilisable n’est accessible aux utilisateurs. Après téléchargement, déchiffrer l’archive avec `node scripts/piecemaker/ui-updates/windows-validation/private-package.mjs decrypt paquet.zip.enc paquet.zip chemin/cle-privee.pem`.

La connexion Pro ou Team avec un compte réel reste une vérification manuelle sur le poste Windows ; aucune clé réelle n’est utilisée par la CI.

## Validation locale

Sur Mac, sans build de l’application : 989 tests frontend passent ; 58 tests du plugin passent et 7 sont réservés à d’autres environnements. Les contrôles TypeScript frontend, backend et plugin passent. Les tests ciblés couvrent aussi l’échec d’installation partielle, la conservation du diagnostic, les fichiers de modèle épinglés et le chargement du SDK avec un appel d’outil fictif.

Justice.fr répond par une page de maintenance au moment du contrôle. Le dictionnaire signale maintenant cette indisponibilité temporaire explicitement ; aucune définition n’est inventée pour contourner l’arrêt du service externe.

## Validation Windows du 28 octobre 2026

Le [parcours Windows complet](https://github.com/PieceMaker-Legal/piecemaker-droit-francais/actions/runs/40665519742) réussit pour le commit `86d9a6cf8b124ece75ad4d971b2ff24e4271b7a7`, version applicative `2.0.54` : 989 tests frontend, 61 tests du plugin et 11 tests SDK passent. Quatre tests du plugin sont réservés à d’autres environnements.

L’installateur signé passe l’installation NSIS, le premier démarrage, les paramètres Mistral, l’aller-retour d’outil SDK sans compte réel, le chargement GLiNER avec inférence locale, le proxy actif, la conservation de session, la désinstallation et la réinstallation. Les rapports `gliner-verification.json`, `mistral-sdk-verification.json`, `installation-verification.json` et `reinstallation-verification.json` sont inclus dans le paquet chiffré.

L’artefact `PieceMaker-Validation-Windows-x64-26` contient uniquement l’archive chiffrée. Le paquet est récupéré et déchiffré localement ; son empreinte SHA-256 est vérifiée. Aucune release, publication npm ou mise à jour utilisateur n’est déclenchée. La connexion Pro ou Team avec le compte du testeur reste à effectuer sur son Windows depuis les paramètres.
