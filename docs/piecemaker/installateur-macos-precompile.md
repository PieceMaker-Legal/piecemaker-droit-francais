# Application macOS précompilée

Le bootstrap reconnaît désormais l’asset de release
`piecemaker-desktop-darwin-arm64.tar.gz`, accompagné de son fichier `.sha256`.
Il télécharge le bundle `PieceMaker.app` construit par la CI au lieu d’installer
les dépendances npm et de compiler Electron sur le poste utilisateur.

Le workflow PieceMaker `piecemaker-macos-python.yml`, déjà appelé par
`release.yml`, prépare Python puis utilise le même `buildDesktopApp()` que le
parcours existant : staging CloudCLI, ressources PieceMaker et electron-builder.
Il archive le bundle, calcule son empreinte et le joint à la release. La
publication finale attend la réussite de ce workflow ; aucun nouveau workflow
upstream ni installateur parallèle n’est ajouté.

Le client vérifie SHA-256 avant extraction, les chemins de l’archive, les liens
internes du bundle, l’exécutable et les ressources serveur requises. Les liens
relatifs des frameworks et les modes exécutables sont conservés par le tar macOS.
Une archive présente mais corrompue ou incomplète arrête l’installation avant le
remplacement de l’application en place. La signature locale par l’identité de
l’utilisateur reste effectuée par le parcours existant après placement ; aucun
certificat Developer ID ni compte Apple n’est requis par cette construction.

Les anciennes releases sans cet asset conservent leur repli sur les sources.
Le prérequis Xcode est vérifié uniquement lors de cette construction locale,
et n’empêche plus de télécharger un bundle précompilé. Le bootstrap télécharge
encore les sources pour ses scripts et les composants Python : ce changement
supprime la compilation locale, pas encore cette archive de scripts. Le Node
dédié de bootstrap reste également utilisé.

Le nom de téléchargement accepte aussi `darwin-x64`, mais le workflow ajouté à
ce parcours ne produit que l’asset ARM64. macOS Intel conserve donc le parcours
historique tant qu’aucun asset Intel n’est fourni.

Vérification locale : dix tests de préparation et d’extraction, dont les liens
internes, les modes exécutables, les empreintes locales et distantes invalides,
les chemins externes, un bundle incomplet et une tentative d’écriture au travers
d’un lien externe. Les tests utilisent le vrai `/usr/bin/tar` sur macOS et des
bundles fictifs. Ils ne lancent pas de compilation Vite et n’installent pas une
nouvelle application sur le poste.

Aucune release n’est créée par ce changement. La fabrication complète sur le
runner, le téléchargement public, la signature locale et le lancement du nouveau
bundle restent à qualifier lors d’une release autorisée. La signature locale
n’est pas une notarisation Apple et n’établit pas à elle seule le comportement
de Gatekeeper après téléchargement.
