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
Le prérequis Xcode est vérifié uniquement lors de cette construction locale.
Le bootstrap télécharge et vérifie maintenant le bundle avant les sources ou
Node. Le staging embarque ses scripts de préparation dans
`Contents/Resources/app/desktop-bootstrap/` avec le mécanisme déjà utilisé sous
Windows. Lorsque ces scripts sont présents, le Node d’Electron les exécute :
ni le dépôt entier, ni un Node de bootstrap ne sont téléchargés. Le module de
construction est chargé uniquement dans le parcours historique ; la préparation
livrée n’importe pas les outils du dépôt.

Le Python commun ARM64 reste vérifié et préparé avant le remplacement de
l’application. La signature locale et le lancement visent ensuite l’application
installée. Le bootstrap exclut son propre PID du contrôle des applications
encore ouvertes et retire `ELECTRON_RUN_AS_NODE` avant le lancement graphique.
Une transaction privée contient le téléchargement et l’extraction ; elle est
retirée après le retour de la préparation, y compris en cas d’échec. Les anciens
caches et sources restent conservés. Un bundle ancien sans ces scripts reprend
le parcours historique avec les sources et un Node externe.

Le nom de téléchargement accepte aussi `darwin-x64`, mais le workflow ajouté à
ce parcours ne produit que l’asset ARM64. macOS Intel conserve donc le parcours
historique tant qu’aucun asset Intel n’est fourni.

Vérification locale : tests de préparation et d’extraction, dont les liens
internes, les modes exécutables, les empreintes locales et distantes invalides,
les chemins externes, un bundle incomplet et une tentative d’écriture au travers
d’un lien externe. Les tests utilisent le vrai `/usr/bin/tar` sur macOS et des
bundles fictifs. Ils ne lancent pas de compilation Vite et n’installent pas une
nouvelle application sur le poste.

Les tests du bootstrap vérifient aussi l’absence des téléchargements de sources
et de Node, les replis historiques, le blocage sur empreinte absente ou invalide,
les liens externes et le nettoyage borné à la transaction. Les tests de
préparation vérifient l’import sans outils de construction, l’ordre Python,
placement, signature et lancement, ainsi que la détection de l’application
ouverte. Ces tests de préparation passent également dans le Node d’Electron
de l’application installée, sans la remplacer ni générer de certificat.

Aucune release n’est créée par ce changement. La fabrication complète sur le
runner, le téléchargement public, la signature locale et le lancement du nouveau
bundle restent à qualifier lors d’une release autorisée. La signature locale
n’est pas une notarisation Apple et n’établit pas à elle seule le comportement
de Gatekeeper après téléchargement.
