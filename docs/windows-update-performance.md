# Accélération des mises à jour Windows

Le paquet Windows regroupe les modules JavaScript dans ASAR, conserve sur disque les modules natifs et les scripts exécutés séparément, et retire les dépendances de construction déjà intégrées aux bundles. La sélection examine le serveur, Electron, les surcharges et les sources serveur des plugins. Après chaque `npm prune`, le build rescane tout l'arbre, y compris les dépendances imbriquées, et réinstalle les dépendances requises qu'npm a retirées.

Le relevé `windows-update-dependencies.json` recense 51 dépendances directes retirées du paquet de bureau. Elles restent dans le manifeste source pour construire l'interface. `node-fetch` et `react-scan` n'ont aucune référence dans les sources examinées ; ils sont également exclus du paquet. Le relevé statique ne prouve pas l'absence de toutes les utilisations indirectes : les vérifications du paquet complètent cette sélection.

Les SDK et exécutables OpenAI/Anthropic sont fournis dans une archive séparée, identifiée par le SHA-256 de son contenu. Leur cache persiste entre les versions de l'application. Un contenu inchangé ne se télécharge ni ne se décompresse à nouveau. Un nouveau contenu est téléchargé, vérifié et installé dans un répertoire temporaire avant publication atomique. Les chemins de traversée et les liens d'archive sont refusés. La désinstallation explicite retire ce cache. Les anciennes versions de composants restent conservées ; une politique de rétention reste à ajouter.

Les plugins sont compilés en CI avec des chemins portables, puis associés à l'Electron et aux composants de la machine installée. Aucun chemin du runner CI ne doit servir à lancer un plugin sur le poste utilisateur.

## Publication

Lancer `release.yml` avec la version explicitement choisie. La release GitHub reste en brouillon. Le workflow appelle `piecemaker-windows-release.yml`, qui compile le proxy, les modules natifs et l'application, vérifie les imports natifs et les fournisseurs dans Electron, puis téléverse l'installeur, son blockmap, `latest.yml` et les composants. La publication intervient uniquement après ces étapes. La notification de l'application consulte `/releases/latest`, qui ignore les brouillons : elle ne voit donc pas une version dont l'installeur est encore en préparation.

Une compilation de secours sur le poste Windows nécessite désormais l'option explicite `--build-from-source`. Un artefact absent ne déclenche plus silencieusement une longue compilation. La publication npm intervient toujours avant le paquet Windows ; la notification de l'application utilise GitHub, pas npm.

La vérification du registre utilise une requête non mise en cache et contrôle le nom, la version et l'intégrité de l'artefact. Un 404 anciennement mis en cache ne doit pas bloquer pendant dix minutes une version déjà publiée.

## Mesures locales

Test isolé avec Electron 44.4.1 et electron-builder 26.16.1, assets compilés de 2.0.34 et nouvelles surcharges, sous un nom de produit fictif. Ces premières mesures portaient sur un paquet dont l'interface restait dans l'ASAR ; il ne satisfaisait pas encore les contrôles serveur/interface ajoutés ci-dessous :

| Mesure | Ancien paquet installé | Paquet optimisé de test |
| --- | ---: | ---: |
| Fichiers dans l'application | 35 328 | 6 342 |
| Taille de l'application | 1,60 Go | 492 Mo |
| Installeur | environ 428 Mo | 156 Mo |
| Installation initiale locale | non mesurée | 99,9 s |
| Réinstallation locale | environ 30 min observées pour 2.0.34 | 97,2 s |

La réinstallation de test réutilise la même version. Elle ne mesure pas le téléchargement, le premier téléchargement des composants IA, la suppression de l'ancien arbre de 35 328 fichiers, ni une mise à jour entre deux releases publiées. Le temps total de 2–3 minutes reste à confirmer sur une mise à jour réelle. Le serveur de test répond à `/health` en environ 1,6 seconde, avec l'anonymiseur désactivé dans cet environnement isolé ; ce test ne valide pas le proxy PII ni l'interface complète.

NSIS écrit les horodatages de début et de fin dans `%LOCALAPPDATA%/PieceMaker/update-timings.log`. `differentialPackage` reste booléen : la version 26.16.1 utilisée ne supporte pas la valeur `store-asar` annoncée dans des documentations plus récentes.

## Vérification du serveur et de l'interface empaquetés

`mime@1.6.0`, nécessaire à Express 4 via `send`, est déclaré directement, conservé lors de la sélection des dépendances et explicitement décompressé dans `app.asar.unpacked/node_modules`. Les fichiers `dist/` et `public/` restent également physiques : le serveur exécuté depuis `app.asar.unpacked/dist-server/server/index.js` les cherche dans cette racine. Leur présence dans l'ASAR seul faisait répondre `/health` tout en redirigeant la page d'accueil vers le serveur Vite de développement.

La vérification du paquet lance maintenant le serveur réel sur un port libre, avec une base et des dossiers utilisateur temporaires. Elle exige un `/health` valide, une page d'accueil HTTP 200 sans redirection et un point d'entrée JavaScript servi avec son type MIME. Les contrôles des modules natifs, des SDK IA et de la réutilisation du cache restent exécutés avant publication. L'anonymiseur est désactivé uniquement dans ce test isolé ; son test dédié reste effectué durant la construction.

Une reconstruction locale avec Electron 44.4.1, electron-builder 26.16.1 et les ressources compilées du précédent test reproduit la redirection de l'ancien paquet, puis valide le paquet corrigé avec le serveur et l'interface disponibles en environ 1,9 seconde. Ce contrôle ne remplace pas un test de mise à jour entre deux versions publiques.

Le nouvel installateur isolé pèse 157 229 497 octets. Son installation prend 185,99 secondes et sa réinstallation 148,58 secondes. Après chaque opération, les contrôles des modules, du serveur et de l'interface réussissent. Ces durées sont mesurées autour du processus NSIS, sans téléchargement ni suppression de l'ancien paquet public ; elles ne garantissent pas encore une mise à jour complète en 2–3 minutes.

Le journal NSIS positionne explicitement le curseur en fin de fichier avant chaque écriture : même en mode `a`, [FileOpen initialise le curseur au début](https://nsis.sourceforge.io/Reference/FileOpen). Sans ce déplacement, le marqueur de fin écrasait le début et les installations suivantes écrasaient les traces précédentes. Un exécutable NSIS isolé, compilé avec les macros corrigées puis exécuté deux fois, conserve les quatre événements dans leur ordre.
