# Accélération des mises à jour Windows

Le paquet Windows regroupe les modules JavaScript dans ASAR, conserve sur disque les modules natifs et les scripts exécutés séparément, et retire les dépendances de construction déjà intégrées aux bundles. La sélection examine le serveur, Electron, les surcharges et les sources serveur des plugins ; npm conserve leurs dépendances transitives et optionnelles.

Le relevé `windows-update-dependencies.json` recense 51 dépendances directes retirées du paquet de bureau. Elles restent dans le manifeste source pour construire l'interface. `node-fetch` et `react-scan` n'ont aucune référence dans les sources examinées ; ils sont également exclus du paquet. Le relevé statique ne prouve pas l'absence de toutes les utilisations indirectes : les vérifications du paquet complètent cette sélection.

Les SDK et exécutables OpenAI/Anthropic sont fournis dans une archive séparée, identifiée par le SHA-256 de son contenu. Leur cache persiste entre les versions de l'application. Un contenu inchangé ne se télécharge ni ne se décompresse à nouveau. Un nouveau contenu est téléchargé, vérifié et installé dans un répertoire temporaire avant publication atomique. Les chemins de traversée et les liens d'archive sont refusés. La désinstallation explicite retire ce cache. Les anciennes versions de composants restent conservées ; une politique de rétention reste à ajouter.

Les plugins sont compilés en CI avec des chemins portables, puis associés à l'Electron et aux composants de la machine installée. Aucun chemin du runner CI ne doit servir à lancer un plugin sur le poste utilisateur.

## Publication

Lancer `release.yml` avec la version explicitement choisie. La release GitHub reste en brouillon. Le workflow appelle `piecemaker-windows-release.yml`, qui compile le proxy, les modules natifs et l'application, vérifie les imports natifs et les fournisseurs dans Electron, puis téléverse l'installeur, son blockmap, `latest.yml` et les composants. La publication intervient uniquement après ces étapes. La notification de l'application consulte `/releases/latest`, qui ignore les brouillons : elle ne voit donc pas une version dont l'installeur est encore en préparation.

Une compilation de secours sur le poste Windows nécessite désormais l'option explicite `--build-from-source`. Un artefact absent ne déclenche plus silencieusement une longue compilation. La publication npm intervient toujours avant le paquet Windows ; la notification de l'application utilise GitHub, pas npm.

La vérification du registre utilise une requête non mise en cache et contrôle le nom, la version et l'intégrité de l'artefact. Un 404 anciennement mis en cache ne doit pas bloquer pendant dix minutes une version déjà publiée.

## Mesures locales

Test isolé avec Electron 44.4.1 et electron-builder 26.16.1, assets compilés de 2.0.34 et nouvelles surcharges, sous un nom de produit fictif :

| Mesure | Ancien paquet installé | Paquet optimisé de test |
| --- | ---: | ---: |
| Fichiers dans l'application | 35 328 | 6 342 |
| Taille de l'application | 1,60 Go | 492 Mo |
| Installeur | environ 428 Mo | 156 Mo |
| Installation initiale locale | non mesurée | 99,9 s |
| Réinstallation locale | environ 30 min observées pour 2.0.34 | 97,2 s |

La réinstallation de test réutilise la même version. Elle ne mesure pas le téléchargement, le premier téléchargement des composants IA, la suppression de l'ancien arbre de 35 328 fichiers, ni une mise à jour entre deux releases publiées. Le temps total de 2–3 minutes reste à confirmer sur une mise à jour réelle. Le serveur de test répond à `/health` en environ 1,6 seconde, avec l'anonymiseur désactivé dans cet environnement isolé ; ce test ne valide pas le proxy PII ni l'interface complète.

NSIS écrit les horodatages de début et de fin dans `%LOCALAPPDATA%/PieceMaker/update-timings.log`. `differentialPackage` reste booléen : la version 26.16.1 utilisée ne supporte pas la valeur `store-asar` annoncée dans des documentations plus récentes.
