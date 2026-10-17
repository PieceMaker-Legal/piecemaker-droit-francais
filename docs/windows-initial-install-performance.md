# Installation initiale Windows : audit et corrections

L'installation Windows utilise maintenant directement NSIS lorsque la release fournit son installateur et son SHA-256. Le script ne telecharge alors ni les sources du projet, ni Node.js, ni npm. Electron fournit l'interpreteur pour la preparation initiale. Les anciennes releases sans ce nouvel artefact de controle conservent le parcours archive existant ; la compilation locale exige toujours `--build-from-source`.

Les modifications sont locales a la branche de travail. Elles ne changent pas l'installateur public tant qu'une nouvelle release n'est pas construite et publiee.

## Ce qui ralentissait la premiere installation

| Travail sur le poste utilisateur | Effet | Correction |
| --- | --- | --- |
| Telechargement et extraction de tout le depot | Fichiers de developpement et ecritures inutiles | Installateur NSIS direct |
| Installation de Node avec npm sur une machine vierge | Telechargement et extraction supplementaires | Node embarque dans Electron |
| Extraction du paquet tar puis copie de toute l'application | Deux arbres physiques, analyses antivirus et I/O repetes | Extraction directement par NSIS dans la destination |
| Resolution et installation Python avec pip | Acces multiples au registre, nombreux petits fichiers, comportement variable selon le poste | Python autonome et bibliotheques installes avant la release |
| Dependances de l'ancienne automatisation du bureau | Modules natifs, Jimp et ses dependances encore livres | Suppression des paquets inutilises et de leurs dependances exclusives |
| Sources et intermediaires de compilation SQLite | Environ 46 Mo inutiles dans le paquet de reference | Seul le binaire de production est conserve dans `build/` |
| Versions sources, ESM et bundles navigateur de pdf-lib | Copies supplementaires d'une meme bibliotheque | Conservation du chemin CommonJS utilise par le serveur |
| Binaires natifs pour Linux, macOS et Windows ARM64 | Taille et fichiers sans utilite pour l'installateur x64 | Exclusion des variantes et des sources non necessaires |

## Dependances retirees

`@nut-tree-fork/nut-js`, `screenshot-desktop`, `node-fetch`, `fuse.js` et `rehype-raw` sont retires des declarations directes de `package.json` et du lockfile. Les recherches dans le serveur, Electron, les modules partages, la surcouche et les serveurs de plugins ne trouvent aucun appel aux deux paquets optionnels. La recherche etendue aux sources frontend ne trouve pas d'utilisation directe de Fuse ou rehype-raw. L'application utilise le `fetch` natif de Node >=22. Une dependance transitive conserve sa propre version de ces paquets lorsqu'elle la requiert.

Le premier nettoyage local sous Node 22/npm 10 retire 164 paquets installes et ajoute 5 paquets necessaires a la reconciliation du lockfile. Le retrait de Fuse et rehype-raw retire ensuite 5 paquets supplementaires. Le nettoyage du stage Windows de reference retire 126 paquets. Ces nombres portent sur deux arbres differents et ne s'additionnent pas.

Le selecteur de runtime examine maintenant les syntaxes d'import, d'export et de `require`, au lieu de toute chaine contenant le nom d'un paquet. La chaine `react` qui decrit un type de plugin ne justifie plus d'embarquer React dans les modules du serveur. React reste necessaire a la compilation de l'interface.

54 dependances directes du manifeste de reference sont exclues du runtime Windows, dont les deux anciennes dependances optionnelles. Les 24 dependances serveur conservees, plus electron-updater ajoute au stage, sont listees dans [windows-update-dependencies.json](windows-update-dependencies.json). Les dependances du frontend restent disponibles pour sa compilation ; `react-scan` est effectivement importe dans `src/main.tsx` pour le diagnostic en developpement. La precedente mention de son absence d'utilisation etait incorrecte.

Les neuf paquets ProseMirror restent declares : `@eigenpal/docx-editor-core` et `@eigenpal/docx-editor-react` les exigent comme dependances peer. Les deux paquets Eigenpal sont toujours importes par `src/piecemaker/docx/DocxDocumentViewer.tsx`, malgre leur avertissement de deprecation npm. Le plugin Tailwind Typography reste utilise dans `tailwind.config.js`. Leur absence d'import direct dans les seuls fichiers du serveur ne signifie pas qu'ils sont inutilises.

## Python prepare avant la release

La CI construit une distribution autonome Python 3.12 Windows x64. Elle installe les requirements de conversion avec `--only-binary=:all:` ; une dependance sans wheel fait echouer la construction au lieu de lancer une compilation sur le poste utilisateur. GLiNER2 et MinerU restent hors de ce socle : leur preparation demarre automatiquement a l'ouverture de l'application. Le suivi « Systeme de pseudonymisation » est accessible par l'icone en haut a gauche et le bouton de l'onglet Dossier, sans fenetre automatique.

La release fournit l'archive Python, son SHA-256 et les metadonnees embarquees dans l'application. Le poste verifie l'archive, refuse les liens et chemins de traversee, extrait dans un dossier temporaire, execute le controle reel des imports, puis publie le dossier et sa configuration. Les noms des dossiers de preparation sont courts pour limiter les erreurs de chargement de DLL liees aux chemins Windows. Une configuration Python deja operationnelle est reutilisee.

La CI teste le paquet apres extraction dans un autre dossier contenant des espaces, verifie les imports natifs NumPy/Pandas et convertit un document Word fictif. Le test interdit tout appel a pip pendant l'installation et tout telechargement lors de la reutilisation du cache. Python et les composants IA sont prepares en parallele lors de la premiere installation.

Le premier lancement de l'executable telecharge directement prepare aussi les certificats locaux et Python lorsqu'ils manquent. La commande PowerShell effectue cette preparation avant d'ouvrir l'application. Le certificat du proxy est propre a chaque poste et ne peut pas etre genere une fois pour tous les utilisateurs. L'autorisation existante pour son enregistrement dans le magasin de confiance est conservee.

## Mesures sur Windows

Paquet de test isole, base sur la 2.0.37 locale (serveur/binaires de 2.0.36, interface compilee en 2.0.37) et un identifiant de produit fictif. Le telechargement Internet n'est pas inclus. Les essais ne constituent pas une mesure de bout en bout depuis une release publique sur une machine Windows neuve.

| Mesure | Reference locale 2.0.37 | Paquet allege de test |
| --- | ---: | ---: |
| Installeur | 163 240 535 octets | 144 867 461 octets |
| Application hors composants externes | 524 140 237 octets | 441 483 223 octets |
| Fichiers de l'application hors des archives | 6 683 | 4 891 |
| node_modules physiques | 116 430 292 octets | 35 455 239 octets |
| Fichiers des node_modules physiques | 5 547 | 3 726 |
| Processus NSIS | 154,09 s lors du remplacement precedent | 74,33 s en installation initiale isolee |

Le test installe dans un dossier temporaire, verifie le serveur, l'interface, SQLite, bcrypt, ConPTY, la generation PDF et les SDK, puis desinstalle le produit fictif. Un premier essai prenait 77,22 s ; le paquet final valide prend 74,33 s. Les conditions et caches different entre les mesures NSIS : elles ne garantissent pas un facteur d'acceleration constant.

L'archive Python mesure 174 095 184 octets. Sa copie locale, son controle, son extraction et sa validation prennent 48,68 s ; sa reutilisation prend 1,80 s. Ces mesures sont distinctes de NSIS et ne doivent pas etre presentees comme une duree totale d'installation. Les transferts des SDK IA, les certificats et le lancement complet s'ajoutent. L'archive Python conserve actuellement tous les extras MarkItDown pour preserver les formats supportes.

La verification du paquet charge aussi le module natif ConPTY et genere un PDF, pour detecter une suppression de binaires ou de fichiers necessaires que de simples imports JavaScript ne reveleraient pas. Elle importe la preparation initiale depuis le paquet physique. Les dependances imbriquees sont declarees physiques a leur emplacement d'origine et a la racine : electron-builder peut les remonter pendant la collecte. Un test supplementaire de commande ConPTY n'a pas termine dans le delai de 30 secondes ; le parcours interactif du terminal reste donc a verifier separement.

## Priorites pour aller plus loin

| Priorite | Action | Validation attendue |
| --- | --- | --- |
| 1 | Mesurer le parcours complet depuis une release construite, sur un compte Windows vierge, avec plusieurs debits reseau | Temps du clic jusqu'a l'interface et a la premiere conversion ; chronometrage separe du transfert, de NSIS, des SDK, de Python et des certificats |
| 1 | Prefetcher les archives Python et IA pendant le telechargement ou l'execution de NSIS | Fait : `install.ps1` telecharge Python et les SDK pendant NSIS, puis `prepare-installed` lit `PIECEMAKER_PREBUILT_ASSET_DIR` |
| 1 | Mesurer l'impact antivirus avant de choisir une nouvelle compression ou un nouveau format | Trace Defender montrant quels fichiers et processus absorbent le temps |
| 2 | Auditer les extras MarkItDown : Azure, YouTube, audio et gros paquets de tests | Matrice des formats reellement exposes et conversions representatives avant tout retrait |
| 2 | Regrouper davantage le serveur JavaScript et ses dependances dans des bundles | Moins de fichiers physiques ; routes, plugins, imports dynamiques, fournisseurs et terminal valides dans Electron |
| 2 | Exclure les declarations de types et source maps restantes des modules de production | Comptage sur le paquet termine, imports et fonctions verifies ; conserver les licences et les donnees chargees par les bibliotheques |
| 2 | Stabiliser et verrouiller les versions du runtime Python, puis definir sa politique de renouvellement | Reproductibilite du build, corrections de securite distribuees et reutilisation entre releases compatibles |
| 2 | Signer l'installateur et l'application avec une identite editeur reconnue | Parcours SmartScreen teste ; ne pas confondre signature editeur et CA locale d'anonymisation |
| 3 | Comparer compression NSIS et extraction ; etudier MSIX si les mesures le justifient | Comparaison sur le temps total incluant reseau et extraction ; validation des raccourcis, donnees utilisateur et mises a jour |

Le nombre de fichiers physiques est un levier recommande par [Electron, Application Packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution). [electron-builder, Application Contents](https://www.electron.build/docs/contents/) documente la selection des fichiers et leur repartition entre ASAR et fichiers natifs. Le role de Defender reste une hypothese a quantifier sur cette machine, avec [l'analyseur de performances officiel Microsoft](https://learn.microsoft.com/en-us/defender-endpoint/performance-analyzer-reference) : `New-MpPerformanceRecording` puis `Get-MpPerformanceReport`. Aucune exclusion antivirus n'est ajoutee par ces correctifs.

Le choix d'un Python autonome s'appuie sur [les archives python-build-standalone](https://gregoryszorc.com/docs/python-build-standalone/main/distributions.html). Les possibilites de reduction des extras sont documentees par [Microsoft MarkItDown](https://github.com/microsoft/markitdown/blob/main/README.md).
