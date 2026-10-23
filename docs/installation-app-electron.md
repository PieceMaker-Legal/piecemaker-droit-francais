# Installation de l'application de bureau

## Évolution sur MAJ-continue : Python commun et désinstallation native

Les nouveaux paquets Windows et macOS Apple Silicon construisent désormais un environnement Python commun à partir des verrous `desktop-bootstrap/composants/windows-requirements.txt` et `macos-arm64-requirements.txt` : conversion, GLiNER, MinerU, Vibe 2.25.0 et Légifrance. Les bibliothèques sont préparées en CI ; les poids des modèles restent téléchargés séparément à la demande. Cette archive sera plus volumineuse que l'ancien socle de conversion seul ; aucun gain de temps de première installation n'est encore mesuré.

La release fournit une empreinte des requirements dans `python-runtime.json` et dans le runtime. L'installation vérifie les marqueurs, les imports et l'archive avant de sélectionner le nouveau Python dans la configuration. Un ancien Python fonctionnel ne suffit pas à éviter la migration : les empreintes des requirements et de l’archive attendues par l’application sont comparées, y compris pour un changement d’interpréteur à dépendances identiques. Windows effectue aussi ce contrôle au démarrage ; macOS le fait lors du passage par le bootstrap d’installation ou de mise à jour. Les anciens dossiers sont conservés, sans suppression automatique d'environnements personnels ou non attribués.

Vibe sélectionne l'environnement commun avant les installations externes. Légifrance l'utilise sans créer son propre venv. Les actions GLiNER/MinerU n'installent ni ne désinstallent de bibliothèques dans ce runtime : elles agissent sur les modèles. Une bibliothèque manquante demande une réinstallation du composant de cette release. Le bootstrap macOS Apple Silicon récupère les métadonnées propres à sa plateforme, puis utilise le même installateur d’archive vérifiée que Windows. Le développement et macOS Intel conservent leur parcours historique ; le verrou Windows ne leur est pas appliqué. Le nouvel environnement commun Intel n’est pas qualifié.

Sur macOS, les commandes sont également régénérées dans `bin/` après déplacement. L’archive Python est construite avec les liens déréférencés : le contrôle d’extraction continue de refuser les liens et les chemins sortant de `python/`. Le bootstrap prépare Python avant de remplacer l’application existante. Le workflow `piecemaker-macos-python.yml`, appelé par `release.yml`, construit et vérifie l’archive native ARM64 ; la publication npm et GitHub attend aussi ce résultat. Aucun nouveau serveur, installateur Electron ou fichier CloudCLI n’est ajouté.

Les commandes Python Windows sont régénérées après extraction pour pointer sur l'interpréteur installé, et le vérificateur du paquet lance réellement `vibe.exe --version` depuis le dossier déplacé. Aucune installation pip n'est exécutée sur le poste pour cette préparation.

Le bouton de désinstallation Windows lance le désinstalleur NSIS fourni par electron-builder ; il ne supprime plus directement l'application avec PowerShell. Il reste sur l'application si le désinstalleur est absent ou ne démarre pas. Les données, modèles, certificats et composants externes sont conservés par ce parcours natif ; il ne constitue pas encore une purge des anciennes installations. Les textes de confirmation reflètent cette conservation. La politique de rétention des caches et le nettoyage fondé sur la propriété restent à traiter séparément.

La skill de développement `.agents/skills/electron-cloudcli/SKILL.md`, déclarée dans `AGENTS.md`, impose de réutiliser en priorité les mécanismes CloudCLI. Les changements présents restent dans les fichiers PieceMaker et leurs tests/workflows ; aucun nouveau raccord dans un fichier CloudCLI n'est ajouté.

Vérification locale de cette intégration : 104 tests du bootstrap/packaging/UI continue, 35 tests Vibe, 5 tests des modèles locaux et 3 tests Python du lanceur MCP réussis ; 4 tests ignorés au total (plateforme ou essai réseau optionnel). Contrôle TypeScript serveur et lint ciblé réussis. Le contrôle TypeScript global échoue dans des fichiers frontend non modifiés par cette tâche. Aucun paquet Windows de cette modification n'a encore été construit ni exécuté : les workflows existants ont été complétés pour vérifier les imports après déplacement, le lanceur Vibe et le changement d'empreinte. Aucune version n'est publiée par ce travail local.

La qualification macOS Apple Silicon et les versions exactes sont détaillées dans [le rapport Python commun](piecemaker/python-commun/README.md#essai-réel-sur-le-mac-de-développement). Elle utilise le Node de l’application installée, un runtime temporaire, des documents fictifs et les modèles locaux ; elle ne remplace pas l’application en place.

Sur macOS, le retrait conserve également les modèles Hugging Face, la configuration
MinerU et le trousseau de signature, qui peuvent être partagés entre installations.
Le certificat retiré du trousseau utilisateur est identifié par l’empreinte du
certificat propre à cette installation, jamais par le seul nom « PieceMaker Local CA ».
Les contrôles d’imports à froid du Python disposent de cinq minutes, lors de la
construction comme après extraction ; ils échouent toujours sans sélectionner
un environnement dont la vérification ne réussit pas.

Le [rapport Mistral, Word et cycle macOS](piecemaker/validation-mistral-word-macos-2026-10-22.md) décrit le parcours réel de remplacement, retrait et réinstallation, ainsi que les onze phases de mise à jour continue. L’interface se télécharge en arrière-plan et s’active au lancement suivant après avoir quitté l’application. La qualification d’un nouveau bundle natif distribué reste distincte.

## Installation existante et parcours historiques

Installateur autonome de l'application Electron PieceMaker sur **macOS** et
**Windows**. Il ne dépend d'aucun autre installateur du dépôt et vit
entièrement dans `desktop-bootstrap/`.

Sur Windows, les nouvelles releases fournissent un **installateur NSIS précompilé**
signé Authenticode `CN=PieceMaker` (certificat auto-signé du projet, sans
nom de personne), et son SHA-256. Le bootstrap importe le certificat public
dans `TrustedPublisher` et `Root` (sans cela Windows rapporte Authenticode
`UnknownError`), lance NSIS et, pendant cette extraction, télécharge
Python et les SDK IA. Le Node embarqué prépare ensuite la CA **locale** du
proxy et le TLS localhost. L'utilisateur ne signe pas l'application. Aucun téléchargement des sources ou installation de
Node/npm n'est nécessaire dans ce parcours. Les anciennes releases sans checksum
d'installateur conservent le parcours archive. Une construction locale Windows
exige `--build-from-source`. Détails et mesures :
[windows-initial-install-performance.md](windows-initial-install-performance.md).

Sur macOS, la construction locale utilise encore les sources et la chaîne Electron
existante (`electron/`, `scripts/release/prepare-desktop-app.js`, `npm run desktop:pack`).
Le déroulé historique ci-dessous décrit ce parcours et les anciennes releases Windows.

## Commande d'installation

macOS :

```sh
curl -fsSL https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/desktop-bootstrap/install.sh | sh
```

Windows (PowerShell) :

```powershell
irm https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/desktop-bootstrap/install.ps1 | iex
```

Pour passer des options, télécharger le script puis l'exécuter :

```sh
curl -fsSL -o install.sh https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/desktop-bootstrap/install.sh
sh install.sh --no-launch
```

Options : `--no-certificate` (ne déclare pas l'autorité locale au système et ne
signe pas l'application ; l'autorité elle-même est toujours générée, le proxy
d'anonymisation en a besoin),
`--no-launch` (n'ouvre pas l'application à la fin),
`--no-progress` (n'ouvre pas la fenêtre d'installation).

Variables d'environnement : `PIECEMAKER_TAG` (version à construire, par défaut
la dernière *release* publiée), `PIECEMAKER_REPO`, `PIECEMAKER_BOOTSTRAP_HOME`
(défaut `~/.piecemaker/bootstrap`), `PIECEMAKER_HOME` (défaut `~/.piecemaker`),
`PIECEMAKER_NODE_CHANNEL`, `PIECEMAKER_COMPONENTS_HOME` (déplace l'interpréteur
Python dédié et le venv ; par défaut ils restent dans `PIECEMAKER_HOME`),
`PIECEMAKER_NO_PROGRESS=1` (même effet que `--no-progress`).

## Déroulé

1. **Garde-fous** — macOS ou Windows 64 bits uniquement ; sur macOS, `curl`,
   `tar`, `openssl` et les *Command Line Tools* Xcode sont exigés.
2. **Fenêtre d'installation** — dès que Node est disponible, `lib/progress.mjs`
   sert une page locale (`installer-ui/index.html`) sur `127.0.0.1`, derrière un
   jeton aléatoire, et l'affiche dans une fenêtre native sans navigateur :
   WebKit piloté en JXA sur macOS (`lib/window-darwin.js`), WebView2 dans une
   fenêtre WinForms sur Windows (`lib/window-win32.cs`, profil dédié dans
   `~/.piecemaker/bootstrap/fenetre-installation`). Elle suit les étapes, porte
   le logo PieceMaker (`public/logo-256.png`) et, **à la première installation
   seulement**, guide la création des identifiants PISTE (voir « Identifiants
   PISTE »). Une mise à jour (`--no-launch`) n'ouvre pas ce guide. Sur Windows,
   le bootstrap NSIS l'affiche après l'extraction (`lib/finish-install.mjs`).
   `--no-progress` ou `PIECEMAKER_NO_PROGRESS=1` désactive la fenêtre ; un échec
   d'ouverture n'interrompt pas l'installation.

   Pourquoi pas Tk ni WinForms : le Python des *Command Line Tools* embarque
   Tk 8.5, déprécié par Apple ; sur macOS 26 sa fenêtre reste vide et hors
   écran. Une seule page HTML sert les deux systèmes, avec captures, liens et
   champs de saisie.
3. **Résolution de la version** — `releases/latest` de l'API GitHub. Les tags
   `v1.37.x` hérités de CloudCLI amont ne sont donc jamais choisis par erreur.
4. **Sources** — archive du tag décompressée dans
   `~/.piecemaker/bootstrap/src/<tag>/`.
5. **Node.js** — si le poste n'a pas Node ≥ 22, une version dédiée est
   téléchargée depuis nodejs.org dans `~/.piecemaker/bootstrap/toolchain/`.
   Rien n'est installé au niveau système, aucun gestionnaire de paquets requis.
6. **Autorité locale** — générée (ou réutilisée si encore valide) avant la
   construction : le proxy d'anonymisation s'en sert pour intercepter les appels
   aux API d'IA, et le test ci-dessous la vérifie.
7. **Proxy d'anonymisation** — compilé juste après `npm install` (`cargo build --release`), puis **testé en
   bac à sable** par `server/piecemaker/anonymizer/hudsucker-smoke.cjs` avant
   toute autre étape. Un échec interrompt l'installation : l'application déjà
   installée n'est pas remplacée, les sessions existantes continuent de
   fonctionner. Détail plus bas (« Test du proxy en bac à sable »).
8. **Construction** — `npm install`, `npm run build`, `npm run desktop:stage`,
   puis `electron-builder --dir` avec `CSC_IDENTITY_AUTO_DISCOVERY=false` pour
   qu'electron-builder n'aille pas chercher une identité de signature du poste.
   Les trois étapes de `desktop:pack` sont appelées séparément afin d'insérer,
   entre la préparation et l'empaquetage, une **complétion de l'arbre de
   dépendances** : `prepare-desktop-app.js` recopie certains paquets à la main
   (`jimp`, `@nut-tree-fork/*`) sans leurs dépendances transitives, ce
   qu'electron-builder refuse (*Production dependency @jimp/custom not found*).
   L'installateur relève les dépendances déclarées mais absentes de
   `.desktop-build/desktop-app/node_modules` et les installe en
   `--no-save --omit=dev`. Aucun script amont n'est modifié.

   Toujours entre la préparation et l'empaquetage, trois ajouts sont insérés
   dans l'arbre de *stage* (voir « Serveur embarqué » ci-dessous) : le serveur
   local compilé, les ressources PieceMaker non compilées, et la surcouche
   d'ouverture automatique. Le manifeste généré du *stage* est complété en
   conséquence (`files`, `main`, `build.extraMetadata.main`).
9. **Installation** — `/Applications/PieceMaker.app` (repli sur
   `~/Applications` si le dossier n'est pas accessible en écriture), ou
   `%LOCALAPPDATA%\Programs\PieceMaker` avec raccourcis menu Démarrer et
   Bureau. Le remplacement est un échange, jamais « supprimer puis copier » :
   l'ancienne version est renommée à côté (`.PieceMaker.app.previous`,
   `.PieceMaker.previous`), la nouvelle copiée, puis l'ancienne retirée ; si la
   copie échoue, l'ancienne est remise en place. Sous Windows, un dossier
   contenant un exécutable lancé ne peut être ni renommé ni supprimé : les
   processus lancés depuis le dossier de l'application (fenêtre, serveur
   maintenu en arrière-plan, proxy d'anonymisation) sont d'abord fermés
   proprement, puis arrêtés au bout de 15 s. Si le dossier reste verrouillé,
   l'installation s'arrête sur un message clair et l'application en place
   reste intacte.
10. **Certificat** — déclaration de confiance et signature, voir ci-dessous.
11. **Composants Python** — MarkItDown et pypdf dans un venv. GLiNER et
   MinerU sont préparés automatiquement en arrière-plan à l'ouverture de
   l'application, avec suivi dans « Système de pseudonymisation ».
12. **Lancement** de l'application, au clic sur « Ouvrir PieceMaker » dans la
    fenêtre d'installation (automatique sans fenêtre).

Les étapes 4 à 8 et 11 sont idempotentes : sources, Node, venv et modèles déjà
présents sont réutilisés, et un certificat encore valide n'est pas régénéré.

**Dossier courant.** L'installateur ne s'exécute jamais depuis le dossier qu'il
hérite : lancé par la mise à jour intégrée, ce dossier est celui de
l'application que l'étape 9 remplace. Sur macOS il disparaît et `pip` échoue
ensuite sur `os.getcwd()` (constaté à l'installation de MinerU) ; sous Windows
il verrouille le dossier et empêche son remplacement. Quatre verrous
indépendants, chacun suffisant :

- `install.sh` et `install.ps1` se placent dans `~/.piecemaker/bootstrap`
  (`install.ps1` change aussi `[Environment]::CurrentDirectory`, que
  `Set-Location` laisse sur le dossier d'origine) ;
- `lib/install.mjs` fait `process.chdir` vers ce même dossier ;
- `composants/install.mjs` lance toute commande dans le dossier personnel
  quand aucun `cwd` n'est donné ;
- `server/piecemaker/desktop-update/` lance l'installateur et la relance
  depuis le dossier personnel.

`composants/install.test.mjs` vérifie qu'une commande aboutit alors que le
dossier courant a été supprimé ; `lib/place.test.mjs` vérifie l'échange.

## Windows : application précompilée à chaque release

Sous Windows, l'installateur ne compile plus rien sur le poste dans le cas
nominal. À chaque release, le workflow
`.github/workflows/piecemaker-windows-release.yml` (appelé par `release.yml`,
relançable à la main avec un `tag`) construit sur `windows-latest`, signe
l'installeur, et attache à la release :

| Fichier | Contenu |
|---|---|
| `piecemaker-droit-francais-desktop-*-win-x64.exe` | installateur NSIS signé Authenticode éditeur |
| `piecemaker-python-win32-x64.tar.gz` | Python 3.12 + MarkItDown, hors GLiNER |
| `piecemaker-gliner-<revision>.tar.gz` | arbre Hub GLiNER2-PII épinglé (`blobs`, `refs/main`, `snapshots`) |
| `piecemaker-runtime-components-win32-x64-*.tar.gz` | SDK OpenAI/Anthropic, cache persisté |
| `piecemaker-hudsucker-win32-x64.exe` | proxy d'anonymisation (Rust) |
| `better-sqlite3-electron-win32-x64.node` | module natif compilé pour l'Electron du `package-lock.json` |
| `piecemaker-desktop-win32-x64.tar.gz` | archive héritée, conservée pour les anciennes releases |

Chaque fichier a son `.sha256`. `install.ps1` lance NSIS et télécharge Python
et les SDK pendant l'extraction, dans
`~/.piecemaker/bootstrap/prebuilt/<tag>/`.
Un artefact absent n'entraîne plus de compilation locale : il faut
`--build-from-source`. Visual Studio et Rust ne sont jamais nécessaires.

## Test du proxy en bac à sable

Si le binaire `piecemaker-hudsucker` ne démarre pas ou n'anonymise pas, le
serveur refuse toute session d'IA (`startRequiredAnonymizer`). Le test le
détecte avant l'installation, sans toucher aux données réelles :

- dossier temporaire jetable (`HOME` redirigé), base `auth.db` de test avec un
  seul mapping fictif, ports éphémères, faux serveur Anthropic sur `127.0.0.1`
  (`--upstream-map`) : aucun appel ne sort du poste ;
- sur macOS, le binaire tourne sous `sandbox-exec` : réseau sortant limité à la
  boucle locale, écriture limitée au dossier temporaire. Sur Windows, seul
  l'isolement par dossier et ports s'applique ;
- l'autorité utilisée est la vraie autorité locale (`~/.piecemaker/certs`, en
  lecture seule).

Contrôles : démarrage et port réel annoncé, santé du réécrivain, aller-retour
JSON (le distant voit le code, le client lit le nom), flux SSE recollé et
restitué, refus d'un corps non JSON (415), refus si le réécrivain tombe (502),
arrêt du proxy quand son parent ferme son entrée.

Lancement manuel, par exemple avant de remplacer un binaire :

```sh
node server/piecemaker/anonymizer/hudsucker-smoke.cjs \
  [--binary <chemin>] [--ca-cert <crt> --ca-key <key>] [--no-sandbox]
```

Sans `--ca-cert`/`--ca-key`, une autorité jetable est générée. Code de sortie 0
si tout passe, 1 sinon.

## Composants Python

`desktop-bootstrap/composants/` installe, hors du bundle Electron :

- un Python 3.10 à 3.13 déjà présent sur le poste, sinon un CPython 3.12
  autonome (python-build-standalone) dans `<destination>/python` ;
- le venv `<destination>/venv` : MarkItDown et pypdf. `gliner2[local]` et
  huggingface-hub sont installés depuis l'application. Les poids GLiNER
  restent épinglés : ils sont l'arbre
  Hub du commit `59894c087cb2923b01f337d4ee72f6ff84d5bdd6` (`config.json`,
  `model.safetensors`, `tokenizer.json`, `tokenizer_config.json`,
  `encoder_config/config.json`), chargé depuis
  `snapshots/<revision>/` avec `local_files_only`.

MinerU 4 (`mineru==4.0.11`, modèle MinerU2.5-Pro en GGUF et modules ONNX de
mise en page et d'OCR) et GLiNER sont téléchargés automatiquement à
l'ouverture de PieceMaker s'ils manquent, sans fenêtre automatique. Une icône
en haut à gauche porte un point bleu tant que la préparation n'est pas terminée.
Elle ouvre « Système de pseudonymisation » : rôle des outils, progression et
possibilité de réessayer. Le bouton de l'onglet Dossier ouvre le même suivi.
Les installations sont successives et une installation en cours est réutilisée
après un rechargement de l'interface. Paramètres › Modèles locaux permet aussi
de les supprimer ou de les réinstaller (routes
`POST /api/piecemaker/configuration/install` et `/configuration/uninstall`).

`<destination>` est `PIECEMAKER_COMPONENTS_HOME`, ou `PIECEMAKER_HOME` si cette
variable est absente. Elle ne contient que l'interpréteur et le venv. Les
poids GLiNER restent dans le cache Hugging Face, et ceux de MinerU dans `~/.mineru/models`.
Le chemin du venv est enregistré dans `config.json` (`pythonPath`, `venvPath`) :
c'est ce fichier que l'application lit. Déplacer le dossier de code ne demande
que la ligne qui l'importe dans `desktop-bootstrap/lib/install.mjs` — il
n'importe rien du reste du bootstrap. Déplacer les binaires installés se fait
en relançant avec `PIECEMAKER_COMPONENTS_HOME`.

## Serveur embarqué et ouverture sur l'interface PieceMaker

L'application de bureau CloudCLI est un *thin shell* : `electron/localServer.js`
cherche `dist-server/server/index.js` dans le bundle et, à défaut, télécharge un
serveur depuis les *releases* GitHub. Aucune release PieceMaker ne publie cet
artefact : sans intervention, l'application s'ouvre sur le lanceur CloudCLI et
aucun serveur ne démarre. L'installateur comble cela en trois temps.

**1. Serveur local compilé.** `dist-server/` est recopié dans le *stage*. Il est
lancé par Electron avec `ELECTRON_RUN_AS_NODE=1`, donc dans le Node d'Electron :
electron-builder reconstruit `better-sqlite3`, `bcrypt` et `node-pty` pour l'ABI
exacte de la version d'Electron empaquetée.

**2. Ressources non compilées.** `tsc` n'émet que les `.js` issus des `.ts`, or
le serveur résout plusieurs chemins relatifs à la racine applicative
(`findApplicationRoot`) : `server/piecemaker/router.cjs`,
`server/piecemaker/anonymizer/service.cjs`,
`server/piecemaker/harness/decisions.cjs` et tout
`server/piecemaker/vendor/`. Sans eux, le serveur s'arrête au démarrage sur
*Cannot find module … verify-citations.cjs*. L'installateur recopie donc
`server/piecemaker/` en excluant les `.ts` (déjà compilés), `node_modules`,
`__pycache__`, `.env`, `.DS_Store`, et les skills et agents de
`piecemaker-plugin/` — le MCP Légifrance vendu (`vendor/mcp/legifrance/`),
le skill `docx-cli` (`vendor/skills/docx-cli/`) et le skill
`redaction-juridique` (copié depuis `vendor/piecemaker-plugin/skills/`)
sont inclus. Un fichier témoin, le lanceur Légifrance et les `SKILL.md`
docx-cli et rédaction-juridique sont vérifiés avant de poursuivre.

**3. Ouverture automatique.** `bootstrap()` d'amont n'ouvre jamais la cible
locale : le serveur ne démarre qu'au clic sur « Open Local CloudCLI ».
`desktop-bootstrap/overlay/electron-piecemaker/main.js` est recopié dans le
*stage* et devient le point d'entrée Electron à la place de `electron/main.js`,
qu'il se contente d'importer. À la première fenêtre chargée, il appelle
`window.cloudcliDesktop.openLocal()` — exactement le chemin qu'emprunte le clic
utilisateur, via le pont `contextBridge` déjà exposé par `electron/preload.cjs`.
L'application s'ouvre donc directement sur l'interface PieceMaker et ses
plugins.

Sur Windows uniquement, `windowsTitleBar.js` rétablit la barre CloudCLI avec
ses onglets et réserve 44 px au-dessus de la vue de contenu. La barre conserve
sa zone de déplacement et la marge Windows de 150 px pour les boutons système.
La surcouche est installée avant le démarrage Electron ; ses styles sont
réappliqués à chaque chargement du lanceur. Les fenêtres de réglages, macOS
et Linux conservent leur comportement existant.

**4. Port propre au produit.** `electron/localServer.js` sondait le port 3001
d'amont ; tout autre service déjà à l'écoute sur ce port (un serveur MCP local,
par exemple) répond à la sonde `/health`, échoue le contrôle
`isCloudCliServer()`, et l'application abandonne après 30 s sur *Bundled backend
did not become ready*. Le port par défaut est donc lu dans
`product.config.json` (`desktopPort`, 3101), avec repli sur la valeur amont 3001.

C'est la seule modification d'un fichier amont — deux lignes, une substitution
avec repli, au titre de l'isolation des données. Tout le reste est ajouté à
côté : la surcouche dans son propre dossier, et le manifeste **généré** du
*stage* complété à la construction.

**5. Environnement du terminal.** Lancée depuis le Finder ou le Dock, l'app ne
reçoit que le PATH minimal de macOS : `claude`, `codex`, nvm ou Python installés
via les fichiers du shell (`~/.local/bin`, `.zprofile`, `.zshrc`) sont
introuvables, alors qu'ils le sont en PWA, dont le serveur est lancé depuis un
terminal. `server/piecemaker/shell-environment.ts` applique la méthode de VS Code
et de `shell-env` : au démarrage du serveur de bureau (`ELECTRON_RUN_AS_NODE=1`),
avant tout processus enfant, il lance une fois `$SHELL -i -l -c`, lit
l'environnement en JSON entre deux repères, place le PATH du shell en tête et
ajoute les variables absentes, sans écraser celles fixées par l'app. Délai
maximal : 10 s. En cas d'échec, le serveur démarre avec le PATH de base et
l'interface affiche un avertissement (`GET /api/piecemaker/shell-environment`,
`src/piecemaker/shell-environment/`). Windows n'est pas concerné : une app
lancée depuis l'Explorateur hérite déjà du PATH du registre.

## Le certificat auto-signé

Une mini-autorité de certification propre au poste est générée à l'installation
dans `~/.piecemaker/certs/`, puis deux certificats en sont dérivés :

| Fichier | Rôle |
| --- | --- |
| `piecemaker-ca.crt` / `.key` | autorité locale, signe les deux certificats ci-dessous |
| `localhost.crt` / `.key` (macOS), `localhost.pfx` (Windows) | TLS du serveur local — `https://localhost`, administration, PWA |
| `piecemaker-signing.crt` + `.p12` / `.pfx` | signature de l'application construite sur place |

Avant tout enregistrement dans le magasin de confiance, **une fenêtre
graphique** s'affiche. Elle explique en clair que le certificat est généré sur
place, qu'il ne quitte pas le poste, qu'il n'engage que le compte courant, à
quoi il sert et qu'il est réversible. Un seul clic — « Autoriser » / « OK » —
déclenche l'enregistrement ; « Annuler » poursuit l'installation sans
certificat, l'application restant utilisable en HTTP local.

Après accord :

- **macOS** — `security add-trusted-cert -r trustRoot -k <trousseau de session>`,
  sans `-d` et **sans privilège administrateur** : la confiance est déclarée
  dans le domaine utilisateur, ce qui ne demande aucun mot de passe.
  L'application est ensuite signée avec l'identité locale importée dans un
  trousseau dédié `~/Library/Keychains/piecemaker-signing.keychain-db`, protégé
  par un secret aléatoire (`~/.piecemaker/certs/signing-keychain.secret`) : le
  mot de passe de session n'est jamais demandé ni manipulé.
- **Windows** — import dans `Cert:\CurrentUser\Root` (avertissement de sécurité
  Windows natif, pas d'élévation administrateur) et dans
  `Cert:\CurrentUser\TrustedPublisher`, puis `Set-AuthenticodeSignature` sur
  `PieceMaker.exe`.

Un échec de signature n'interrompt pas l'installation : il est signalé et
l'application reste utilisable.

### Pourquoi le panneau est une application sur macOS

Déclarer une confiance touche au *Security framework*, qui exige une session
graphique. Un `do shell script … with administrator privileges` la retire au
processus fils, d'où l'échec `SecTrustSettingsSetTrustSettings: The
authorization was denied since no user interaction was possible` lorsque
l'installateur tourne depuis un shell détaché.

`panel-darwin.mjs` contourne cela sans élévation : il compile le panneau en
`.app` (`osacompile`) et l'ouvre par `open -W`, ce qui le place dans la session
Aqua. L'installateur peut donc se dérouler **de bout en bout** depuis un shell
d'arrière-plan, sans terminal interactif et sans mot de passe administrateur.

Le bundle PKCS#12 de signature est exporté avec
`-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1` : les réglages par
défaut d'OpenSSL 3 (Homebrew) produisent un `.p12` que `security import`
rejette (*MAC verification failed*).

### Désinstaller

Sous Windows, la voie standard est **Paramètres › Applications › Applications
installées › PieceMaker › Désinstaller**. L'installateur y enregistre
PieceMaker sous `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PieceMaker`
(par utilisateur, sans droits administrateur). Le bouton lance
`PieceMaker.exe --piecemaker-uninstall`, qui demande confirmation puis exécute
la même désinstallation que l'onglet de l'application.

Avant de supprimer quoi que ce soit, le script Windows attend 15 s puis arrête
les processus qui verrouillent encore des fichiers : serveur local, workers
Python du venv, fenêtre Edge de l'installateur (dont le profil est dans
`bootstrap`). Les certificats sont retirés un par un (personnel, éditeurs
approuvés, puis racine, qui demande une confirmation Windows), et l'entrée
« Applications installées » est retirée en dernier.

Dans l'application installée, les réglages ont un onglet **Désinstaller** sous Notifications.
Le retrait conserve la base `auth.db` (et ses fichiers `-wal`/`-shm`) et la
Bibliothèque (`~/.piecemaker/library-backend`), ainsi que les références et dates
d’historique Mistral (`vibe-session-origins`, `vibe-message-times`). Sur macOS, il conserve aussi les
modèles et le trousseau de signature partagés. Il retire :

- l'application, les raccourcis Windows et le certificat local propre à cette installation ;
- `~/.piecemaker` (`PIECEMAKER_HOME`) vidé de tout sauf la Bibliothèque et les
  métadonnées Mistral conservées ci-dessus : Node
  et Rust de `bootstrap/`, Python, venv, certificats, configuration, historique
  des dossiers, facturation, profil PWA, journaux ;
- le dossier de données produit (`~/.piecemaker-droit-francais`, `CLOUDCLI_HOME`)
  vidé de tout sauf `auth.db` : plugins, sauvegardes, journaux ;
- les dossiers Electron (`userData`, `logs`, `crashDumps`) et, sur macOS, les
  préférences, caches, `HTTPStorages`, `WebKit` et `Saved Application State` de l'`appId` ;
- dans le parcours Windows historique seulement, les modèles GLiNER et MinerU
  (`~/.mineru`, et `mineru.json` d'une ancienne installation) ; NSIS conserve
  les composants externes dans le parcours actuel.

Seuls les chemins situés sous le dossier personnel sont touchés ; un dossier
qui contiendrait `auth.db` plus profondément (`DATABASE_PATH` personnalisé) est
épargné. Les dossiers juridiques eux-mêmes ne sont pas supprimés, ni les
skills, agents et connecteurs que la Bibliothèque y a activés : ce sont des
fichiers du dossier (`.agents/skills`, `.claude`, `.mcp.json`…), recensés dans
`.piecemaker/library.json`, que les assistants lisent sans PieceMaker.

### Retirer le certificat

macOS, **depuis le Terminal** (`remove-trusted-cert` exige lui aussi une
session graphique) :

```sh
security remove-trusted-cert "$HOME/.piecemaker/certs/piecemaker-ca.crt"
security delete-certificate -c "PieceMaker Local CA" "$(security default-keychain -d user | tr -d ' \"')"
security delete-keychain ~/Library/Keychains/piecemaker-signing.keychain-db
rm -rf ~/.piecemaker/certs
```

Windows :

```powershell
Get-ChildItem Cert:\CurrentUser\Root, Cert:\CurrentUser\TrustedPublisher, Cert:\CurrentUser\My |
  Where-Object { $_.Subject -match 'PieceMaker Local' } | Remove-Item
Remove-Item -Recurse -Force "$env:USERPROFILE\.piecemaker\certs"
```

## Mise à jour depuis l'application

Sur macOS, le bouton « Mettre à jour » de la fenêtre de nouvelle version
relance cet installateur au lieu de la commande npm de CloudCLI : la route
`POST /api/system/update` est interceptée par
`server/piecemaker/desktop-update/` lorsque le serveur tourne depuis un bundle
`*.app/Contents/Resources/app`. Elle exécute
`curl …/main/desktop-bootstrap/install.sh | sh -s -- --no-launch` (dernière
release publiée du dépôt de `product.config.json`), renvoie la sortie à la
fenêtre, puis quitte l'application et rouvre le bundle réinstallé.

À partir de v2.0.33, les bundles Windows utilisent `electron-updater` et
l'installateur NSIS produit par le workflow `piecemaker-windows-release.yml`.
La release contient l'installateur `.exe`, son `.blockmap` et `latest.yml`,
en plus de l'archive conservée pour l'installation initiale et la transition.
La route `POST /api/system/update` transmet la demande au processus Electron
par une passerelle loopback à adresse aléatoire, héritée par le serveur local.
L'updater attend la fin du téléchargement avant de proposer « Redémarrer et
installer » ou « Plus tard ». Un échec de téléchargement remonte au bouton ;
« Plus tard » n'installe rien à la fermeture de l'application.
Le remplacement est confié à NSIS dans le dossier de l'application en cours,
et le serveur local est arrêté à la fermeture même si son maintien est activé.
Le message de l'interface indique la fin de la préparation, pas une installation
réussie avant le redémarrage. Après relance, vérifier la version dans À propos.
Les builds signés vérifient la signature des mises à jour ; sans les secrets
Windows, le workflow conserve la distribution non signée existante et vérifie
l'intégrité des fichiers selon les métadonnées `electron-updater`.
Le test complet nécessite deux versions installées sur Windows et des assets
de release disponibles ; les tests locaux du raccord ne remplacent pas ce test.

Avant v2.0.33, la même route est interceptée lorsque le serveur tourne depuis
`…\PieceMaker\resources\app`. Elle lance `install.ps1` (sans `--no-launch`)
dans un PowerShell détaché via `Start-Process`, et répond aussitôt. Le
détachement est nécessaire : l'installateur ferme PieceMaker avec
`taskkill /T`, ce qui tuerait un installateur resté enfant de l'application.
La fenêtre d'installation suit la mise à jour et propose de rouvrir
l'application.

Les autres installations (sources git, npm) retombent sur le comportement
CloudCLI d'origine. Les versions antérieures à ce mécanisme (Windows : avant
v2.0.29) doivent être mises à jour une fois à la main avec la commande
d'installation.

## Carte des fichiers

```
desktop-bootstrap/
  install.sh                     entrée macOS (curl | sh)
  install.ps1                    entrée Windows (irm | iex)
  composants/
    install.mjs                  venv, MarkItDown, pypdf
  installer-ui/
    index.html                   page de la fenêtre d'installation
    piste/                       captures de piste.gouv.fr pour le guide
  overlay/
    electron-piecemaker/main.js  point d'entrée Electron, ouvre la cible locale
  lib/
    install.mjs                  orchestrateur des étapes
    build.mjs                    build, stage, serveur embarqué, surcouche, empaquetage ; téléchargements précompilés (Windows)
    build-release.mjs            construction de l'archive Windows par la CI (piecemaker-windows-release.yml)
    windows-npm-shim.mjs         préchargement : npm/npx lancés via npm-cli.js sous Windows
    certificates.mjs             aiguillage de plateforme
    certificates-darwin.mjs      openssl, confiance utilisateur, codesign
    certificates-win32.mjs       New-SelfSignedCertificate, magasins, Authenticode
    panel-darwin.mjs             panneau d'autorisation macOS en session graphique
    consent.mjs                  texte d'autorisation et panneau Windows
    progress.mjs                 état, serveur local de la fenêtre, attente du guide PISTE
    window-darwin.js             fenêtre WebKit macOS (JXA)
    window-win32.cs              fenêtre WebView2 Windows
    webview2/                    SDK WebView2 redistribué (x64)
    finish-install.mjs           guide PISTE après l'installeur NSIS
    piste.mjs                    validation et enregistrement des identifiants PISTE
    place.mjs                    installation, raccourcis, lancement
    paths.mjs                    emplacements et noms de produit
    shell.mjs                    exécution de processus
    ui.mjs                       sortie console et relais vers la fenêtre
```

## Identifiants PISTE

À la première installation, la fenêtre propose un guide en quatre étapes, une
action à la fois, illustré de captures repliées de piste.gouv.fr
(`installer-ui/piste/`, adresses fictives) :

1. création du compte (`/registration`, « Code de l'organisation » laissé vide) ;
2. acceptation des CGU de Légifrance et JUDILIBRE en PROD
   (`/apimgt/consentement-cgu-api`) — sans elle, les cases de ces API sont
   grisées à l'étape suivante ;
3. création d'une application **PRODUCTION** (`/apps`) avec Légifrance et
   JUDILIBRE cochés dans « Souscrite » ;
4. copie du Client ID et du Client Secret (« Identifiants Oauth » de la fiche
   d'application), avec boutons « Coller » qui lisent le presse-papiers par
   `pbpaste` ou `Get-Clipboard`.

Les boutons n'ouvrent que les liens de `PISTE_LINKS`, dans le navigateur par
défaut. Les identifiants sont vérifiés (`lib/piste.mjs`) : jeton OAuth, recherche
Légifrance, `healthcheck` Judilibre ; le message d'échec dit laquelle des trois
étapes bloque. Valides, ils sont fusionnés dans `~/.config/mcp-legifrance/.env`
(0600, `LEGIFRANCE_ENV=production`), le fichier que lisent le harness
Légifrance, la Tabular Review et le MCP Légifrance. Déjà présents, le guide est
remplacé par une confirmation (« Remplacer les identifiants »).

Le guide ne bloque pas l'installation, qui se poursuit pendant que
l'utilisateur le remplit. Une fois l'installation terminée, la fenêtre reste
ouverte tant que les identifiants ne sont ni enregistrés ni reportés (« Je le
ferai plus tard »), puis propose « Ouvrir PieceMaker » : l'application n'est
lancée qu'à ce clic, après quoi la fenêtre se ferme. Fermer la fenêtre sans
cliquer termine l'installateur sans ouvrir l'application. Sans fenêtre
(`--no-progress`, CI, ou fenêtre jamais affichée), l'application est ouverte
automatiquement. Avec `--no-launch` (mise à jour intégrée), ni le guide ni
l'ouverture ne sont proposés et rien n'attend.

## Rapport au reste du dépôt

- **Un seul fichier CloudCLI est modifié**, au titre de l'isolation des
  données : `electron/localServer.js` lit son port par défaut dans
  `product.config.json`, avec repli sur la valeur amont. `git diff` sur
  `scripts/` ou `package.json` reste vide ; l'installateur se contente
  d'appeler les scripts npm existants.
- Il est indépendant de la commande `piecemaker` et de
  `server/piecemaker/vendor/installer/` : aucun code n'est partagé avec eux.

## Limites connues

- macOS et Windows uniquement, 64 bits. Linux n'est pas pris en charge.
- La commande `curl` pointe sur `main`, mais construit la dernière *release*
  publiée : tant qu'une release ne contient pas `desktop-bootstrap/`, utiliser
  `PIECEMAKER_TAG` pour viser un tag qui l'embarque.
- Sur macOS, la construction compile les dépendances natives (`better-sqlite3`,
  `bcrypt`, `node-pty`) ; les *Command Line Tools* sont vérifiés en amont. Sur
  Windows, voir « Windows : application précompilée à chaque release ».
- Sur macOS, première installation longue (dépendances + build), quelques
  minutes. Sur Windows, quelques minutes seulement grâce à l'archive
  précompilée, sauf repli sur la construction locale.
- Le certificat de signature est auto-signé : il supprime l'avertissement lié à
  un binaire non signé, mais ne vaut pas notarisation Apple ni réputation
  SmartScreen.
- La fenêtre Windows s'appuie sur le runtime WebView2 (fourni avec Edge) ;
  sans ce runtime, l'installation continue sans fenêtre.
- Les captures PISTE vieilliront avec le portail : les refaire quand
  piste.gouv.fr change de présentation.
