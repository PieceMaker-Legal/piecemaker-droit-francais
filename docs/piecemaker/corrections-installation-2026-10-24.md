# Corrections du second audit d’installation

Branche `MAJ-continue`. Suite du [second audit](audit-installation-simplification-2026-10-24.md).

## Changements et preuves

- Les certificats Mac sont vérifiés ensemble : clés appariées, dates, signature, usages, adresses localhost et contenu du P12. Les dérivés sont réparés sous la même CA ; une CA manquante ou invalide bloque avant remplacement des fichiers. La clé perdue exige une sauvegarde ou une nouvelle autorité explicitement approuvée. [Matrice et limites](reparation-certificats-macos-2026-10-24.md).
- Le chemin Windows de cette version refuse la construction client depuis les sources avant toute préparation. NSIS reste propriétaire de l’installation et du retrait. Les anciennes releases exécutent leurs propres scripts historiques ; elles ne sont pas modifiées.
- L’archive Hub GLiNER sans consommateur standard et son travail CI sont retirés. Le téléchargement Hugging Face épinglé, les bibliothèques d’inférence et le pipeline restent en place.
- Le plan de retrait Mac ne contient plus les branches Windows inaccessibles après délégation à NSIS, les anciennes recherches de modèles ni la lecture inutile de configuration MinerU. Les plans et scripts Mac restent identiques sur les 30 combinaisons comparées.
- La condition SQLite impossible est supprimée ; l’appel de téléchargement Windows et les règles de reconstruction des modules natifs restent inchangés.
- Le bootstrap Mac vérifie le bundle avant d’utiliser son Node embarqué et ses scripts de préparation. Il conserve le repli historique lorsqu’une ancienne release ne livre pas ce contrat. Les nouvelles transactions de téléchargement sont temporaires ; leurs fichiers sont retirés à la fin du script.
- Le nettoyage SDK récupère seulement les nouvelles transactions temporaires dont le processus propriétaire est prouvé terminé. Les processus actifs, erreurs d’inspection, chemins inconnus et copies de récupération sont conservés.
- Le marqueur de confiance sans lecteur est retiré. La confiance reste contrôlée par le système et le consentement reste demandé par le parcours existant. Les anciens fichiers de marqueur ne sont pas supprimés chez l’utilisateur.
- Les lanceurs Python intacts ne sont plus réécrits ni soumis à un changement de permissions inutile. La génération en mémoire et le contrôle restent effectués ; les lanceurs absents, corrompus ou déplacés sont réparés. Aucun manifeste supplémentaire ni gain de temps supposé. Le format ZIP Windows est rendu déterministe.

## Limite de rétention

La rétention des anciennes versions SDK/Python, des anciens temporaires non attribués et des sources historiques reste à définir. Les chemins peuvent encore servir à des installations coexistantes, à un processus actif ou à un retour arrière. Il manque un contrat complet de références pour prouver qu’une version n’est plus utilisée. Une suppression par âge ou par nombre de versions risquerait de casser ces usages.

## Portée de la vérification

Les tests de certificats utilisent de vrais fichiers et OpenSSL, y compris le LibreSSL natif macOS, sans modifier le trousseau. Le nettoyage SDK comprend l’interruption réelle d’un processus de test. Les contrôles du bootstrap combinent de vraies archives temporaires et des exécutables de substitution pour simuler les réponses réseau et le lancement Electron.

Vérification d’ensemble sous Node 24.11.1 : 190 contrôles réussis et 2 ignorés, en comptant la relance ciblée Python après correction de la canonisation `/var` / `/private/var` dans la fixture. La passe globale a validé 185 contrôles ; le fichier Python relancé valide 7 contrôles, dont 2 déjà comptés. Les deux contrôles ignorés exigent Windows. Les lanceurs sont exécutés dans un vrai venv temporaire, y compris après déplacement vers un chemin contenant des espaces ; le format ZIP du lanceur Windows est simulé localement. Quatre tests de préparation Mac ont également été exécutés dans le véritable Node embarqué d’Electron. Les workflows conservent ces nouveaux tests ciblés sur leurs plateformes respectives.

Les trois workflows modifiés passent l’analyse YAML. Le shell passe `sh -n` et les fichiers JavaScript modifiés passent `node --check`.

Ces contrôles ne constituent pas une nouvelle installation Windows réelle ni une qualification du téléchargement d’une future release publique. Aucun build Vite, publication ou remplacement de l’application de l’utilisateur n’est requis pour ces vérifications.
