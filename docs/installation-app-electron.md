# Installation de l'application de bureau (build local)

Installateur autonome de l'application Electron PieceMaker sur **macOS** et
**Windows**. Il ne dépend d'aucun autre installateur du dépôt et vit
entièrement dans `desktop-bootstrap/`.

Principe : rien n'est téléchargé sous forme de binaire prêt à l'emploi.
L'application est **construite sur le poste de l'utilisateur** à partir des
sources de la dernière version publiée, avec la chaîne Electron déjà présente
dans CloudCLI (`electron/`, `scripts/release/prepare-desktop-app.js`,
`npm run desktop:pack`). Un binaire construit localement n'est pas mis en
quarantaine par le système : il n'y a donc pas de signature éditeur à acheter.

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

Options : `--no-certificate` (saute entièrement l'étape certificat),
`--no-launch` (n'ouvre pas l'application à la fin).

Variables d'environnement : `PIECEMAKER_TAG` (version à construire, par défaut
la dernière *release* publiée), `PIECEMAKER_REPO`, `PIECEMAKER_BOOTSTRAP_HOME`
(défaut `~/.piecemaker/bootstrap`), `PIECEMAKER_HOME` (défaut `~/.piecemaker`),
`PIECEMAKER_NODE_CHANNEL`.

## Déroulé

1. **Garde-fous** — macOS ou Windows 64 bits uniquement ; sur macOS, `curl`,
   `tar`, `openssl` et les *Command Line Tools* Xcode sont exigés.
2. **Résolution de la version** — `releases/latest` de l'API GitHub. Les tags
   `v1.37.x` hérités de CloudCLI amont ne sont donc jamais choisis par erreur.
3. **Sources** — archive du tag décompressée dans
   `~/.piecemaker/bootstrap/src/<tag>/`.
4. **Node.js** — si le poste n'a pas Node ≥ 22, une version dédiée est
   téléchargée depuis nodejs.org dans `~/.piecemaker/bootstrap/toolchain/`.
   Rien n'est installé au niveau système, aucun gestionnaire de paquets requis.
5. **Construction** — `npm install`, `npm run build`, `npm run desktop:stage`,
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
6. **Installation** — `/Applications/PieceMaker.app` (repli sur
   `~/Applications` si le dossier n'est pas accessible en écriture), ou
   `%LOCALAPPDATA%\Programs\PieceMaker` avec raccourcis menu Démarrer et
   Bureau.
7. **Certificat** — voir ci-dessous.
8. **Lancement** de l'application.

Les étapes 3 à 5 sont idempotentes : sources et Node déjà présents sont
réutilisés, et un certificat encore valide n'est pas régénéré.

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

## Carte des fichiers

```
desktop-bootstrap/
  install.sh                     entrée macOS (curl | sh)
  install.ps1                    entrée Windows (irm | iex)
  lib/
    install.mjs                  orchestrateur des étapes
    build.mjs                    build, stage, complétion des dépendances, empaquetage
    certificates.mjs             aiguillage de plateforme
    certificates-darwin.mjs      openssl, confiance utilisateur, codesign
    certificates-win32.mjs       New-SelfSignedCertificate, magasins, Authenticode
    panel-darwin.mjs             panneau d'autorisation macOS en session graphique
    consent.mjs                  texte d'autorisation et panneau Windows
    place.mjs                    installation, raccourcis, lancement
    paths.mjs                    emplacements et noms de produit
    shell.mjs                    exécution de processus
    ui.mjs                       sortie console
```

## Rapport au reste du dépôt

- **Aucun fichier CloudCLI n'est modifié.** L'installateur est une surcouche
  qui se contente d'appeler les scripts npm existants ; `git diff` sur
  `electron/`, `scripts/` ou `package.json` reste vide.
- Il est indépendant de la commande `piecemaker` et de
  `server/piecemaker/vendor/installer/` : aucun code n'est partagé avec eux.

## Limites connues

- macOS et Windows uniquement, 64 bits. Linux n'est pas pris en charge.
- La commande `curl` pointe sur `main`, mais construit la dernière *release*
  publiée : tant qu'une release ne contient pas `desktop-bootstrap/`, utiliser
  `PIECEMAKER_TAG` pour viser un tag qui l'embarque.
- La construction compile les dépendances natives (`better-sqlite3`, `bcrypt`,
  `node-pty`). Sur macOS, les *Command Line Tools* sont vérifiés en amont ; sur
  Windows, en l'absence de binaire pré-compilé, les *Visual Studio Build Tools*
  (charge de travail C++) sont nécessaires.
- Première installation longue (dépendances + build), quelques minutes ; les
  suivantes réutilisent le cache npm et les sources déjà téléchargées.
- Le certificat de signature est auto-signé : il supprime l'avertissement lié à
  un binaire non signé, mais ne vaut pas notarisation Apple ni réputation
  SmartScreen.
