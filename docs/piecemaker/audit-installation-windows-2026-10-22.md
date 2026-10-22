# Audit du cycle d'installation Windows — 22 octobre 2026

## Périmètre et verdict

Audit des sources de `main`, avancée sans fusion jusqu'à `origin/main` local, commit `88c08b0a` (2.0.54). Comparaison avec CloudCLI 1.37.5 (`upstream/main`, `0ce5630f`), dont la version du manifeste a également été vérifiée en ligne. Aucun installateur, désinstallateur ou serveur utilisateur exécuté ; aucun fichier de secrets lu ; aucune suppression de données. Les constats portent sur les programmes et leurs plans de suppression, pas sur un inventaire du poste Windows de l'utilisateur.

Le format EXE n'est pas la cause principale. PieceMaker utilise déjà Electron et NSIS, comme CloudCLI. La complexité vient de plusieurs gestionnaires de composants et de deux parcours de désinstallation qui ne partagent pas leur contrat. Les défauts les plus urgents concernent la suppression et la propriété des ressources, avant une nouvelle optimisation du paquet.

## Carte des emplacements

Les chemins ci-dessous sont les valeurs par défaut des sources ; des variables d'environnement permettent certaines surcharges.

| Emplacement | Rôle | Appréciation |
| --- | --- | --- |
| `%LOCALAPPDATA%\Programs\@piecemaker-legalpiecemaker-desktop` | Application NSIS actuelle, Electron, serveur, MinGit, relais Node | Répertoire applicatif normal, nom technique peu lisible. Le parcours archive historique utilise plutôt `Programs\PieceMaker`. |
| `%APPDATA%\PieceMaker` | Données Electron, réglages du bureau et stockage Chromium | Séparation usuelle entre programme et données. |
| `%USERPROFILE%\.piecemaker` | Configuration technique, certificats, Python, Vibe, MCP, bibliothèque | Trop de cycles de vie regroupés sans inventaire commun. |
| `.piecemaker\runtime-python\<empreinte>\python` | Python autonome de conversion, enrichi par les moteurs locaux | Le paquet initial est précompilé ; les moteurs ajoutent ensuite des dépendances avec pip. |
| `.piecemaker\venv` et `.piecemaker\python` | Parcours historique ou construction locale | Peuvent coexister avec le runtime récent ; pas de migration de nettoyage explicite. Leur présence seule ne prouve pas qu'ils sont inutilisés. |
| `.piecemaker\vibe` | Environnement isolé de Mistral Vibe 2.25.0 | Isolation utile pour ses dépendances et le streaming qui dépend de ses API internes. |
| `.piecemaker\mcp-legifrance\.venv` | Environnement du MCP Légifrance | Isolation volontaire ; installation au premier usage et contrôle par empreinte des requirements. |
| `%USERPROFILE%\.piecemaker-droit-francais` | Base, sessions et plugins de l'application | Racine héritée du fork, distincte de la configuration technique. |
| `%LOCALAPPDATA%\PieceMaker\runtime-components\<empreinte>` | SDK et exécutables Anthropic/OpenAI | Cache vérifié et réutilisable, sans rétention. Ce ne sont pas des installations Node supplémentaires. |
| `.piecemaker\bootstrap` | Installateurs EXE, archives préchargées par version, anciennes sources et éventuel Node de bootstrap | Accumulation évitable après installation réussie. |
| `%USERPROFILE%\.cache\huggingface\hub` et `.mineru` | Modèles locaux | Emplacements partagés avec d'autres logiciels ; propriété non enregistrée. |
| Profils et installations propres aux fournisseurs | CLI externes, authentification et sessions | Ne doivent pas être assimilés automatiquement à des déchets de PieceMaker. |

Sources : `desktop-bootstrap/lib/paths.mjs`, `install.ps1`, `composants/install.mjs`, `overlay/electron-piecemaker/compact-runtime.mjs`, `server/piecemaker/vibe-install.ts`, `server/piecemaker/vendor/mcp/legifrance/scripts/launcher.py`, `product.config.json`.

## Constats classés

### WIN-LIFE-01 — Haute : deux désinstallations incompatibles

Le parcours NSIS récent est utilisé par le bootstrap et les mises à jour. Sa configuration ne définit pas `deleteAppDataOnUninstall` ; son seul include personnalisé, `desktop-bootstrap/lib/update-timings.nsh`, définit `preInit` et `customInstall`, sans `customUnInstall`. Le désinstallateur NSIS n'appelle donc pas le nettoyage PieceMaker de Python, des modèles, des SDK et des certificats externes.

Inversement, l'action intégrée à l'application passe par `electron/piecemakerUninstall.js` et supprime directement les fichiers avec PowerShell. Elle retire la clé `Uninstall\PieceMaker`, créée par l'ancien parcours archive, mais pas la clé GUID NSIS ni la clé d'installation associée. Le bootstrap récent recherche justement cette installation via `Software\be668065-da35-5797-91d0-75b4725f56f1`.

Conséquences attendues : composants conservés après désinstallation Windows ; entrée installée potentiellement orpheline après désinstallation interne ; migration archive vers NSIS sans réconciliation explicite. La conservation de données utilisateur peut être volontaire, mais les deux parcours doivent annoncer et appliquer la même politique.

Vérification : génération du script PowerShell sur des chemins fictifs, absence du GUID NSIS confirmée ; lecture de l'include et des templates NSIS installés (`app-builder-lib/templates/nsis/uninstaller.nsh`, `include/installer.nsh`). Aucune clé réelle supprimée.

Correctif recommandé : NSIS devient l'unique propriétaire de la désinstallation Windows. Le bouton dans l'application lance son désinstallateur. Un hook commun nettoie uniquement les composants possédés par PieceMaker lors d'une désinstallation explicite, jamais lors du retrait d'une ancienne version pendant une mise à jour. Traiter les anciennes clés et chemins par une migration ciblée.

### WIN-LIFE-02 — Haute : suppression fondée sur le nom plutôt que sur la propriété

`componentModelPaths()` dans `electron/uninstallPlan.js` ajoute des dépôts de modèles connus du cache Hugging Face, même sans preuve d'installation par PieceMaker. Le plan ajoute aussi `.mineru` et `mineru.json`. Le script retire les certificats dont le sujet ou l'émetteur contient `PieceMaker`, dans plusieurs magasins, au lieu de cibler des empreintes enregistrées.

Le contrôle « sous le répertoire personnel » limite la portée, mais ne prouve pas que la ressource appartient à l'application. Un modèle utilisé par un autre programme peut donc être sélectionné pour suppression. Aucun effacement externe n'est affirmé sur le poste réel : c'est le plan généré qui démontre le risque.

Correctif recommandé : nouveaux modèles dans un cache privé PieceMaker ; manifeste des ressources créées et des empreintes de certificats. Pour les ressources partagées historiques, conservation par défaut jusqu'à identification certaine. Les certificats d'éditeur et la CA locale du proxy doivent avoir des politiques distinctes.

### WIN-LIFE-03 — Moyenne : aucune rétention des téléchargements et composants

`runtime-components.mjs` conserve les destinations par empreinte ; ses suppressions concernent les fichiers temporaires et le remplacement d'une même destination, pas les anciens identifiants. `install.ps1` conserve les EXE et `bootstrap\prebuilt\<tag>`. `composants/install.mjs` prévoit aussi des destinations Python par empreinte et ne purge pas leurs anciennes versions.

Les SDK accumulent les générations lorsque leur contenu change. Pour Python, la réutilisation de l'environnement configuré limite les nouvelles extractions, mais ne constitue pas une politique de rétention. Un même composant peut rester à la fois en archive et décompressé.

Correctif recommandé : supprimer les archives de transfert après validation, conserver la génération active et au plus une précédente nécessaire au retour arrière, puis nettoyer après un démarrage réussi. Ne jamais purger un environnement encore référencé ou utilisé.

### WIN-LIFE-04 — Moyenne : chemins personnalisés et erreurs de suppression mal suivis

Le plan tient compte de `PIECEMAKER_COMPONENTS_HOME` pour `python` et `venv`, mais pas pour `runtime-python\<empreinte>\python` lorsque ce dossier est hors de la racine technique habituelle. `safeNamedDirectory()` refuse le `venvPath` portable car son dernier composant est `python`, pas `venv`. Une reproduction avec un répertoire de composants fictif situé sous le profil confirme que ce Python n'est couvert par aucune cible de suppression.

Le plan ne suit pas non plus `MINERU_HOME`. Il cible le sous-dossier `runtime-components`, mais pas tous les fichiers de `%LOCALAPPDATA%\PieceMaker`, notamment le journal de timing. Enfin, PowerShell ignore globalement les erreurs, tente cinq suppressions puis retire l'entrée de registre sans bilan des échecs ; son lanceur ignore stdout et stderr.

Correctif recommandé : inventaire explicite des installations, résultat de suppression vérifiable et journal technique expurgé. Un échec de suppression doit être signalé, sans donner l'impression que tout a disparu.

### WIN-LIFE-05 — Moyenne : plusieurs chemins d'installation Python et dépendances évolutives

Le socle Windows arrive précompilé. GLiNER et MinerU sont ensuite installés par l'ancien installateur vendored, qui peut exécuter `pip install --upgrade` dans l'environnement configuré. Les requirements de conversion/GLiNER et du MCP comportent des bornes minimales plutôt qu'un verrouillage complet. Vibe possède son installateur distinct et une version applicative épinglée, mais ses dépendances transitives restent résolues à l'installation.

Deux postes ayant la même version de PieceMaker peuvent donc avoir des dépendances Python différentes. La réutilisation du socle précompilé ne contrôle que la disponibilité de MarkItDown et pypdf : elle ne garantit pas l'alignement avec la nouvelle release. Le conflit de sélection de Vibe était réel, mais son correctif est déjà dans la 2.0.54 ; il ne doit pas être présenté comme un nouveau bug non corrigé.

Correctif recommandé : définir un manifeste de versions et les règles de compatibilité. Préparer en CI des environnements immuables par fonction ; mise à jour atomique. Garder l'isolation Vibe et éventuellement MCP tant que leur fusion n'est pas justifiée par des contraintes et des tests. Un seul énorme venv augmenterait le risque de conflits.

### WIN-LIFE-06 — Haute pour la validation : le cycle Windows réel n'est pas une barrière de release

Le workflow Windows teste des helpers, puis vérifie le runtime dans `win-unpacked` et la présence d'une signature de l'installateur. Le test `initial-install.test.mjs` remplace les téléchargements et le processus d'installation par des doubles. Les tests du désinstalleur contrôlent le texte généré, sans exécuter sa suppression réelle.

Ces vérifications sont utiles, mais aucune étape identifiée n'impose le cycle complet d'installation NSIS, première utilisation, mise à jour depuis une release précédente, désinstallation par Windows puis réinstallation sur un profil vierge. Les précédentes mesures manuelles documentées ne remplacent pas cette barrière.

Correctif recommandé : tests sur Windows jetable avec artefacts réellement publiables ; instantanés des fichiers, du registre, des certificats et des processus avant/après. Vérifier aussi une machine avec Node/Python/uv préexistants et une installation historique. Les dossiers juridiques et les profils externes des fournisseurs doivent rester intacts.

## Ce qui n'est pas un défaut en soi

- `resources\node-shim\node.exe` est un petit programme C# qui lance `PieceMaker.exe` avec `ELECTRON_RUN_AS_NODE=1`. Ce n'est pas un deuxième Node complet. Le serveur réutilise également le Node d'Electron. Un Node système conserve la priorité pour les commandes nues ; cela doit être inclus dans la matrice de tests.
- Les trois fonctions Python (conversion/IA locale, Vibe et MCP) peuvent justifier des dépendances isolées. Un Python de base plus des venvs n'est pas, à lui seul, une anomalie.
- Séparer les programmes, données persistantes et caches est normal. L'anomalie est l'absence d'un propriétaire et d'un cycle de vie cohérent pour chaque emplacement.
- `auth.db`, ses fichiers SQLite annexes et `library-backend` sont volontairement préservés par le désinstalleur interne. Une désinstallation ne promet donc déjà pas une remise à zéro complète.

## Que reprendre de CloudCLI ?

CloudCLI 1.37.5 utilise aussi Electron, electron-builder et NSIS ; son bureau léger télécharge un serveur correspondant à sa version sous `~/.cloudcli/server/<version>` et utilise le Node d'Electron. Il a donc lui aussi une installation répartie. Son `ServerInstaller` conserve les répertoires de versions ; revenir au shell léger ne supprimerait pas automatiquement la question de rétention.

Reprendre son socle de packaging et ses conventions de cycle de vie réduit les comportements spécifiques à maintenir. Conserver nos ajouts dans la surcouche PieceMaker respecte la règle du fork. En revanche, CloudCLI ne fournit pas la gestion du socle Python, des modèles GLiNER/MinerU et des certificats du proxy PieceMaker : copier son EXE ou son arborescence ne résoudrait pas ces responsabilités.

L'architecture actuelle comporte déjà des garanties à conserver : archives vérifiées, refus des chemins traversants/liens, installation préparée avant publication pour les SDK et Python, réutilisation des composants et plugins préparés en CI. Il faut simplifier leur orchestration, pas jeter ces contrôles.

## Ordre recommandé des travaux

| Lot | Changement | Critère de réussite |
| --- | --- | --- |
| 1 | Unifier la désinstallation autour de NSIS et enregistrer la propriété des ressources | Même résultat depuis Paramètres Windows et PieceMaker ; aucune ressource partagée supprimée ; mises à jour sans purge des données. |
| 2 | Inventaire des composants et rétention des archives/générations | Chaque dossier a un rôle, une version, un propriétaire et une règle de conservation ; espace récupéré mesuré. |
| 3 | Stabiliser Python et migrer les anciens chemins | Même release = mêmes versions attendues ; aucune sélection accidentelle par PATH ; anciens environnements supprimés seulement s'ils sont possédés et inutilisés. |
| 4 | Rendre obligatoire le cycle Windows complet en CI | Installation, première session et conversion fictives, mise à jour, arrêt, désinstallation et réinstallation validés sur machine jetable. |

À terme, viser une racine privée de composants/caches sous `%LOCALAPPDATA%\PieceMaker`, des données persistantes identifiées et les dossiers juridiques ailleurs. Une migration progressive suffit : un déplacement global immédiat ajouterait des risques sans résoudre le contrat de désinstallation.

## Vérifications de cette passe

Sélection de 12 fichiers de tests du bootstrap, du packaging, des composants et du désinstalleur : **52 tests, 48 réussis, 4 ignorés, aucun échec**. Les quatre ignorés concernent le bootstrap initial et trois essais du relais Node réservés à Windows. Exécution sur macOS avec Node 24 ; aucun build Vite.

Six assertions supplémentaires sur les plans et sources ont confirmé : absence du hook de nettoyage NSIS, absence de suppression du GUID NSIS par le script interne, sélection de modèles partagés, absence de couverture de `MINERU_HOME`, absence de purge globale du dossier local de logs et absence de couverture du Python portable dans une racine de composants séparée. Elles n'ont exécuté aucune suppression.

Ces résultats valident les constats de code, pas la réussite d'une désinstallation Windows réelle. Aucun correctif applicatif n'est inclus dans cet audit.

Références : [manifest de CloudCLI](https://github.com/siteboon/claudecodeui/blob/0ce5630f/package.json), `upstream/main:electron/serverInstaller.js`, `upstream/main:scripts/release/prepare-desktop-app.js`, [répertoires Electron](https://www.electronjs.org/docs/latest/api/app#appgetpathname), [NSIS et hooks electron-builder](https://www.electron.build/nsis/), [audit Windows antérieur](audit-windows.md), [installation initiale](../windows-initial-install-performance.md), [mises à jour](../windows-update-performance.md).
