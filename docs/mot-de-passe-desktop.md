# Mot de passe de l’application de bureau

L’application macOS et Windows enregistre les identifiants après une connexion
ou une création de compte réussie. Elle réutilise le mot de passe au lancement
si aucune connexion n’est conservée. L’écran de connexion permet aussi de
demander cette reconnexion.

Le fichier `<CLOUDCLI_HOME>/desktop-password.enc` contient uniquement les
identifiants chiffrés. Electron `safeStorage` protège la clé avec le trousseau
macOS ou DPAPI sous Windows. Ce fichier n’est pas une entrée consultable dans
l’application Mots de passe ou le Gestionnaire d’identification Windows.
Aucun email ni serveur distant n’intervient.

## Réinitialisation

1. Dans l’application de bureau, ouvrir « Mot de passe oublié ? » ou Réglages › Téléphone › « Réinitialiser le mot de passe PieceMaker ».
2. Saisir et confirmer le nouveau mot de passe.
3. Valider la demande du système.

macOS utilise `LAContext` et la politique `deviceOwnerAuthentication` :
Touch ID, Apple Watch ou mot de passe système selon le poste.
Le petit exécutable Swift est compilé lors du packaging ; le poste utilisateur
n’a pas besoin de Xcode.

Windows affiche `CredUIPromptForWindowsCredentialsW`, puis vérifie les
identifiants avec `LogonUserW`. Le SID obtenu doit être celui de la session
Windows courante. Un autre administrateur ne peut pas approuver cette action.
Cette voie demande le mot de passe Windows ; le code PIN Windows Hello seul
ne suffit pas. Aucun mot de passe système ne transite par Node ou l’interface.
Le processus PowerShell efface ses buffers avant de terminer.

Une annulation, une identité incorrecte ou un stockage sécurisé indisponible
empêche la réinitialisation. Après validation, le serveur modifie le hash bcrypt
et sa clé de signature dans une transaction SQLite. Il invalide aussitôt les
anciens jetons HTTP et WebSocket. Il ferme aussi les connexions WebSocket
existantes, puis l’application se reconnecte avec les nouveaux identifiants.

Les identifiants du compte et les données restent conservés. Le serveur ne
redémarre pas. Les travaux du chat continuent ; les terminaux suivent le délai
de conservation CloudCLI après déconnexion, actuellement trente minutes.
Les autres appareils doivent saisir le nouveau mot de passe.

Si l’écriture du fichier chiffré échoue après la modification du compte,
l’interface précise que le nouveau mot de passe doit être conservé et saisi.
Un `JWT_SECRET` imposé par l’environnement bloque la réinitialisation : remplacer
la clé uniquement en mémoire réactiverait les anciens jetons au redémarrage.

## Raccord sans modification de CloudCLI

Le point d’entrée desktop installe un preload Electron distinct avec
`session.registerPreloadScript`. Le preload agit uniquement dans le document
principal local. Le processus principal vérifie l’origine exacte du serveur
dans `local-server.json`, puis exige une preuve HMAC sur un défi aléatoire.
Il n’envoie jamais le mot de passe enregistré ni sa capacité d’administration
à un service local qui ne prouve pas son identité.

La capacité aléatoire est créée à chaque lancement. Le serveur la retire de
son environnement avant de lancer les outils. Les routes `/desktop-auth`
du routeur local refusent les navigateurs, les demandes sans capacité et les
en-têtes de passerelle distante. Le défi d’identité ne nécessite pas cette
capacité mais reste limité aux appels locaux sans origine navigateur.

Le serveur démarre avec le hook officiel Node `module.registerHooks`, enregistré
par `--import`. Ce raccord adapte trois points **en mémoire** : la clé JWT devient
renouvelable, les WebSockets se ferment après réinitialisation, et une connexion
commencée avec l’ancien hash ne peut pas délivrer un nouveau jeton après le
changement. Les fichiers CloudCLI sur disque restent intacts.

Chaque substitution exige un motif unique dans le module attendu. Un changement
upstream incompatible arrête le chargement, plutôt que de désactiver la sécurité.
Le mode navigateur/PWA seul conserve le fonctionnement CloudCLI. Le raccord
requiert une nouvelle version complète de l’application, sans modifier son
numéro ni publier automatiquement.

## Vérifications

- Test d’intégration avec SQLite, bcrypt et HTTP réels : refus des appels
  distants, annulation transactionnelle, changement du mot de passe, révocation
  HTTP/refresh/WebSocket et connexion concurrente.
- Tests du processus Electron : chiffrement, origine IPC, faux serveur local,
  refus système et stockage indisponible.
- Test du preload : affichage de la récupération, sauvegarde après succès,
  confirmation du nouveau mot de passe et effacement des champs.
- Sonde native : compilation Swift sur macOS, compilation C# par PowerShell
  sous Windows, sans demande interactive.
- Test Electron réel avec un profil temporaire et des identifiants fictifs :
  stockage système, sauvegarde malgré un rechargement et reconnexion.

Le workflow `piecemaker-desktop-passwords.yml` exécute ces contrôles sur macOS
et Windows. Il ne remplace pas une validation interactive des deux plateformes.
La saisie réelle d’un mot de passe système ne peut pas être automatisée ici.

Validation locale : 33 tests ciblés réussis, contrôles TypeScript serveur et
interface réussis, et essai Electron réel réussi sur macOS. Le vérificateur
Swift a été compilé et sa disponibilité système vérifiée. Le code Windows
a été testé par simulation ; sa compilation et son dialogue natif restent
à valider sur Windows. Le workflow n’a pas été lancé à distance.

## Sources officielles consultées

- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage/)
- [Electron session.registerPreloadScript](https://www.electronjs.org/docs/latest/api/session/)
- [Sécurité Electron et validation des émetteurs IPC](https://www.electronjs.org/docs/latest/tutorial/security)
- [Apple deviceOwnerAuthentication](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication)
- [Apple evaluatePolicy](https://developer.apple.com/documentation/localauthentication/lacontext/evaluatepolicy(_:localizedreason:reply:))
- [Microsoft CredUIPromptForWindowsCredentialsW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-creduipromptforwindowscredentialsw)
- [Microsoft CredUnPackAuthenticationBufferW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credunpackauthenticationbufferw)
- [Microsoft LogonUserW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-logonuserw)
- [Node module.registerHooks](https://nodejs.org/api/module.html#moduleregisterhooksoptions)
