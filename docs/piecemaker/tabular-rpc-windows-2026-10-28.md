# Tabular Review : erreur RPC 500 sous Windows Validation

## Diagnostic

L'édition Validation installe `PieceMakerValidation.exe`. L'hôte des plugins
lance `node launcher.mjs` avec un environnement restreint. Sur un poste sans
Node système, cette commande utilise le lanceur livré dans
`resources/node-shim/node.exe`.

Ce lanceur cherchait toujours `PieceMaker.exe` deux niveaux au-dessus de son
répertoire. Ce fichier n'existe pas dans l'édition Validation. L'exécution sur
le poste Windows reproduit une `System.ComponentModel.Win32Exception` :
« Le fichier spécifié est introuvable », dans `NodeShim.Main()`.

L'appel RPC de l'hôte tente de démarrer le serveur du plugin, qui ne peut pas
annoncer son port. L'erreur de démarrage remonte alors comme une erreur HTTP
500. Le même serveur Tabular Review, lancé directement avec le véritable
exécutable en mode Node, annonce correctement `{ ready: true, port: ... }`.
La panne reproduite précède donc les appels à Mistral et l'analyse des documents.

## Correctif

- Le packaging écrit le nom effectif de l'exécutable dans
  `node-shim/application.txt`, depuis le manifeste final electron-builder.
- Le lanceur C# lit ce nom au lieu de coder `PieceMaker.exe` en dur.
- `buildDesktopApp` prépare le lanceur après `prepareStage`, car ce dernier
  attribue le nom `PieceMakerValidation` à l'édition de test.
- Le mode Node, la transmission des arguments, le code de retour et le lien
  de durée de vie entre lanceur et enfant sont conservés.

Aucun fichier hôte CloudCLI ni profil fournisseur n'est modifié.

## Vérifications

Les quatre tests natifs `desktop-bootstrap/lib/node-shim.test.mjs` passent
sur le poste Windows avec le Node embarqué d'Electron et le compilateur C#
Windows. Ils compilent et exécutent réellement le lanceur : ressources incluses,
nom final Validation après changement du manifeste, arguments et code de retour,
arrêt de l'enfant quand le lanceur s'arrête. Les scripts modifiés passent aussi
le contrôle de syntaxe Node.

Le workflow Windows inclut maintenant ces tests. Le vérificateur de l'application
réellement installée exécute son `node.exe` pour vérifier `process.execPath`,
puis appelle `/api/plugins/piecemaker-tabular-review/rpc/templates` avec le compte
fictif de la CI. Il exige HTTP 200, une liste de modèles et aucune erreur.
Le résultat sera conservé dans `tabular-rpc-verification.json` dans le paquet
de validation. Ce contrôle ne lance aucune analyse IA.

Ces contrôles CI du paquet corrigé restent à exécuter. L'installation du poste
utilisateur n'a pas été modifiée par ce correctif source. Aucun contenu de
dossier, identifiant de connexion ou secret du poste n'est inclus dans ce rapport.
