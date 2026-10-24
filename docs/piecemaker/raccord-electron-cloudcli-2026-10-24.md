# Raccord Electron : corrections du 24 octobre 2026

Travail sur `MAJ-continue`, avec un sous-agent distinct pour chacun des sept
sujets, puis revue et vérification d’intégration. Aucun numéro de version,
build Vite local ou publication.

## Décisions et corrections

| Sujet | Résultat |
| --- | --- |
| Résolution du serveur | Suppression du remplacement de `resolveServerEntry()`. Le chemin `ELECTRON_SERVER_ENTRY` et le calcul de répertoire CloudCLI suffisent. Un vrai processus enfant confirme entrée et répertoire avec espaces. |
| Barre de titre | Retour au calcul CloudCLI de 44 px et au CSS upstream ; suppression de `windowsTitleBar.js`, de son remplacement de prototype et de son injection CSS. Mac et Linux retrouvent aussi la barre visible. |
| Installation Mac | Utilisation d’un bundle précompilé ARM64 lorsqu’il est publié, avec SHA-256, validation des chemins et des liens internes. Le workflow macOS existant le construit avec le staging et electron-builder déjà utilisés. Signature locale après placement conservée. |
| SDK séparés | Conservation du cache par contenu, réutilisable entre versions. Suppression du calcul d’empreinte dupliqué : producteur et installateur partagent le même calcul, avec identité historique vérifiée. |
| Résolution ASAR | Couche nécessaire au packaging actuel. Un test avec vraie archive et Electron a révélé un défaut CommonJS : résolution explicite par `createRequire` dans le repli, sans changement du parcours ESM. |
| Retrait Windows | Suppression du script PowerShell de désinstallation qui n’avait plus d’appel de production, de son helper et des tests orphelins. NSIS reste propriétaire du retrait Windows. |
| Arrêt avant mise à jour | Suppression des remplacements de `getSettings()` et `shutdownOwnedServer()`. L’updater attend l’arrêt de l’arbre possédé et la méthode CloudCLI avant `quitAndInstall()`. Un échec interdit l’installation. |

## Ce qui reste spécifique à PieceMaker

`ServerInstaller` installe un serveur complet, indexé sur la version de
l’application. Il ne remplace pas directement le cache SDK par contenu,
préchargé et publié atomiquement. Le remplacer nécessiterait de perdre ces
propriétés ou de modifier son fonctionnement upstream.

Le résolveur ASAR reste requis pour les modules ESM et CommonJS situés dans
l’archive ou dans le cache externe. Un simple `NODE_PATH` ne couvre pas ces
imports. Le test inclut serveur, Worker et sous-processus de plugin ; la
variante Electron utilise une vraie archive et le préchargement de production.

Le raccord Windows conserve un observateur de `startBundledServer()` pour
capturer le contrôleur possédé : CloudCLI n’expose pas cette instance au
raccord de mise à jour. Il ne change pas ses règles d’arrêt ni les préférences
de fermeture normale. Il est installé uniquement dans Windows empaqueté.
Le raccord de mise à jour d’interface demeure distinct et inchangé.

L’archive officielle `electron-updater@6.8.9`, `out/BaseUpdater.js`, confirme
que l’événement `before-quit-for-update` est émis sur `electron.autoUpdater`,
mais après le déclenchement d’`install()`. Le raccord précédent écoutait le bon
émetteur mais intervenait trop tard ; la correction attend la préparation
avant d’appeler `quitAndInstall()`.

## Vérifications d’intégration

- 133 tests bootstrap, packaging, Electron et mises à jour réussis ; 2 ignorés
  pour Windows réel.
- 82 tests de non-régression Mistral, Word, pipeline Python et modèles réussis ;
  2 ignorés pour plateforme ou essai réseau optionnel.
- Vrai Electron avec vraie archive ASAR : imports ESM et CommonJS réussis dans
  le serveur, le Worker et le plugin enfant, avec des chemins contenant des espaces.
- Extraction macOS avec vrai tar : liens Frameworks et modes conservés,
  corruption, empreinte manquante, chemins externes et liens sortants refusés.
- Vrai contrôleur CloudCLI : démarrage, arrêt et redémarrage de processus
  fictifs ; arrêt refusé ou bloqué interdit l’installation.
- Syntaxe shell et YAML vérifiées ; syntaxe JavaScript et lint ciblé réussis.
- Banc Mac isolé : 14 fichiers runtime actualisés, signature ad hoc vérifiée,
  démarrage natif réussi, cinq plugins et serveur Analyse Tabulaire disponibles,
  graphe du dossier fictif conservé. L’application et ses descendants sont
  arrêtés après contrôle, port de test fermé. Ce banc reprend l’enveloppe et
  l’interface compilée déjà présentes ; il ne qualifie pas un nouvel artefact
  de release ni une installation vierge supplémentaire.

## Limites

Le nouveau bundle Mac précompilé et son téléchargement public ne sont pas
encore produits par une release. Les anciennes releases et Intel sans asset
conservent leur repli sur les sources. L’archive des scripts et le Node de
bootstrap restent nécessaires ; ce changement ne les supprime pas.

Aucune installation NSIS réelle n’est exécutée sur ce Mac. Le contrôle natif
visuel est indisponible pendant cette vérification : le service de contrôle
d’interface ne démarre pas. Les tests de dimensions utilisent la vraie classe
CloudCLI avec Electron simulé ; ils ne remplacent pas un examen visuel Windows.

Les erreurs de typage global déjà recensées dans la revue de branche ne font
pas partie de ces changements. Cette validation ciblée ne signifie pas que
l’intégralité du dépôt ou tous les parcours de distribution sont qualifiés.
