## Problème

L’artefact Windows de validation issu d’un workflow vert ne démarre pas sur le PC utilisateur : les fichiers sont installés et le raccourci existe, mais aucune interface utilisable ne s’ouvre. Le lancement direct révèle un échec lors de l’import du certificat local. Après correction locale, le démarrage franchit cette étape et l’extraction des composants se termine, mais une vérification distante retourne encore HTTP 404.

## Artefact et provenance vérifiés

- Dépôt : PieceMaker-Legal/piecemaker-droit-francais.
- Workflow : PieceMaker Full Windows Validation, exécution n°16 du 23 octobre 2026, statut success.
- Run : https://github.com/PieceMaker-Legal/piecemaker-droit-francais/actions/runs/39962142069
- Fichier workflow : `.github/workflows/piecemaker-windows-validation.yml`.
- Branche : `MAJ-continue`.
- Commit : `bfc8faa07b733b5d1d012a06a5961b8ed034f89c`.
- Artefact : `PieceMaker-Validation-Windows-x64-16`, ID `12506279061`.
- Exécutable dans le ZIP : `PieceMaker-Validation-2.0.47-win-x64.exe`.
- Rapport embarqué : runtime `desktop-2.0.47`.
- Vérification sur le PC : 26 octobre 2026, Windows, PowerShell 7 utilisé comme shell de diagnostic ; l’application invoque `powershell.exe` (Windows PowerShell).

## 1. Bloquant : magasin de certificats inaccessible au démarrage

### Reproduction observée

1. Extraire le ZIP puis lancer l’installateur.
2. L’installation copie les fichiers et crée le raccourci du menu Démarrer.
3. Aucune application PieceMaker ne reste en cours d’exécution lors du contrôle initial.
4. Lancer directement `%LOCALAPPDATA%\Programs\@piecemaker-legalpiecemaker-desktop\PieceMakerValidation.exe` avec stdout/stderr capturés.
5. Le bootstrap échoue dans `trustCertificateAuthority()`.

### Erreur exacte, chemins utilisateur anonymisés

```text
[PieceMaker] Startup failed: Error: powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $ErrorActionPreference = "Stop"; Import-Certificate -FilePath '<profil>\.piecemaker-validation\components\certs\piecemaker-ca.crt' -CertStoreLocation Cert:\CurrentUser\Root | Out-Null a échoué :
Import-Certificate : Lecteur introuvable. Il n'existe aucun lecteur nommé « Cert ».
FullyQualifiedErrorId : DriveNotFound,Microsoft.CertificateServices.Commands.ImportCertificateCommand
```

Pile :

```text
desktop-bootstrap/lib/shell.mjs:26                  mustCapture
desktop-bootstrap/lib/certificates-win32.mjs:161    trustCertificateAuthority
desktop-bootstrap/lib/prepare-installed.mjs:12     prepareInstalledDesktop
electron-piecemaker/compact-runtime.mjs:35         initializeCompactRuntime
electron-piecemaker/main.js:69                     startApplication
```

Le journal local `update-timings.log` contient deux séquences `2.0.47 setup-start` / `2.0.47 application-files-ready`. Cela confirme la copie des fichiers, pas la réussite du premier lancement.

### Diagnostic et correctif local testé

Dans un processus Windows PowerShell neuf, le fournisseur Certificate n’était pas listé avant chargement explicite de `Microsoft.PowerShell.Security`. Le chargement explicite rend le lecteur `Cert:` disponible.

Une première tentative par nom simple :

```powershell
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
```

échoue dans le contexte de lancement de l’application avec des erreurs de données de type dupliquées : `System.Security.AccessControl.ObjectSecurity`, membres `AuditToString`, `AccessToString`, `Sddl`, `Access`, `Group`, `Owner`, `Path` déjà présents. La résolution du module/environnement hérité est donc à examiner ; l’origine exacte de ce conflit n’a pas été démontrée.

La variante qui a débloqué le lancement sur ce PC charge explicitement le module livré avec le Windows PowerShell invoqué :

```powershell
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
```

Modification locale du fichier installé `resources/app.asar.unpacked/desktop-bootstrap/lib/certificates-win32.mjs` : ajout de cet import avant l’accès au magasin, notamment dans `isCaTrusted()` et les scripts contenant `$ErrorActionPreference = "Stop"`. Sauvegarde locale du fichier original en `.before-cert-fix`. Aucun correctif du dépôt ni nouvel installateur n’a été produit pendant ce diagnostic.

Après relance : fenêtre intitulée `PieceMaker` détectée ; bootstrap poursuivi, composants Python extraits et plugins installés. Le fonctionnement complet de l’interface et des assistants n’a pas été vérifié sur ce PC.

### Correction à intégrer et validation attendue

- Charger explicitement le bon module avant les commandes utilisant `Cert:` et contrôler les autres accès au magasin dans ce fichier.
- Tester depuis Explorer et depuis PowerShell 7, sur un profil sans certificat déjà approuvé.
- Exercer le vrai parcours de consentement et d’import, puis vérifier le redémarrage et la persistance de session.
- Rendre l’échec du bootstrap visible et actionnable pour l’utilisateur.

## 2. Trou de couverture : workflow vert avec certificat préapprouvé

Le `installation-verification.json` embarqué annonce :

```json
{
  "installed": true,
  "initialInterface": true,
  "sessionRetained": true,
  "onboardingCompletedThroughUI": true,
  "localCertificateGenerated": true,
  "localCertificateTrusted": true,
  "certificateConsentPreapprovedOnDisposableRunner": true,
  "nativeUninstallVerified": true
}
```

Le certificat préapprouvé sur le runner ne reproduit pas le premier lancement qui a échoué sur le PC utilisateur. Conserver les tests existants, mais ajouter un scénario sans préapprobation qui exerce réellement cette branche du bootstrap.

## 3. Vérification distante en erreur HTTP 404

Observé à la fois dans le journal du runner inclus dans le ZIP et sur le PC après le correctif local :

```text
[PieceMaker UI] Vérification reportée : Téléchargement impossible (404).
```

Le rapport embarqué annonce :

```json
{
  "remoteChannelEmbedded": "https://github.com/PieceMaker-Legal/piecemaker-droit-francais/releases/download/validation-ui-desktop-2.0.47",
  "updateNotPublished": true
}
```

Vérifier la cohérence du canal de validation et des ressources publiées. Le journal ne précise pas l’URL exacte ayant retourné 404 : ne pas attribuer ce code à un fichier précis sans instrumentation complémentaire. Le 404 n’a pas interrompu l’extraction des composants observée sur le PC.

## 4. Erreurs supplémentaires dans le journal CI embarqué

Ces erreurs sont constatées dans `installation-verification.log` du ZIP ; elles n’ont pas toutes été reproduites sur le PC et ne doivent pas être présentées comme des crashes d’installation.

### Initialisation SQLite trop tardive / à vérifier

Au premier démarrage, avant `Database schema applied` et `Database migrations completed successfully` :

```text
[PieceMaker] Publication des projets impossible : SqliteError: no such table: projects
[piecemaker] import des corrections de pièces impossible : no such table: main.projects
Bibliothèque : 1 élément(s) non importé(s) (projets)
```

Pile de la publication : `repositories/projects.db.js:94` → `project-registry.js:8`, `:19`, `:25` → `piecemaker/index.js:50`.

Vérifier l’ordre entre migrations et démarrage des services/imports. L’erreur de table n’apparaît plus dans le second démarrage du journal embarqué ; vérifier aussi que les imports initialement échoués sont rejoués.

### Découverte Codex en échec, aux deux démarrages CI

```text
[PieceMaker] codex model discovery failed: Cannot find module '@openai/codex/bin/codex.js'
Require stack: .../dist-server/server/piecemaker/model-discovery/codex-catalog.js
```

Vérifier la résolution du point d’entrée et le packaging. Cette trace seule ne démontre pas que toutes les fonctions Codex sont indisponibles.

### Découverte Mistral en échec, aux deux démarrages CI

```text
[PieceMaker] mistral model discovery failed: spawn vibe-app-server ENOENT
```

Vérifier la disponibilité/résolution de l’exécutable et le comportement prévu avant installation de ce composant. Le succès de la validation ne prouve pas le fonctionnement de Mistral.

### Autres avertissements CI

```text
No .env file found or error reading it: ENOENT
[DEP0190] DeprecationWarning: Passing args to a child process with shell option true ...
```

Qualifier le premier message selon le caractère optionnel du `.env` dans la distribution ; localiser l’appel à `spawn` concerné par DEP0190. Aucun crash n’est démontré par ces deux messages. Les `SIGTERM` du journal CI surviennent après `before-quit` avec sortie de l’application à 0 : ne pas les classer comme des crashes.

## 5. Version de validation potentiellement décalée

L’artefact compilé le 23 octobre est étiqueté 2.0.47. La liste Actions montre une release `v2.0.54` et son workflow Release réussi dès le 19 octobre : https://github.com/PieceMaker-Legal/piecemaker-droit-francais/actions/runs/39285014311

Cela justifie de vérifier la branche, la version injectée, les composants précompilés et les correctifs réellement inclus. La comparaison des commits entre la release et `MAJ-continue` n’a pas été menée à terme : on ne peut pas conclure à ce stade que tous les correctifs de 2.0.54 sont absents. Éviter de présenter la date récente du workflow comme preuve que l’artefact contient la dernière version.

## Critères de résolution

- Premier lancement réussi sur Windows sans certificat préapprouvé, y compris depuis un environnement PowerShell 7.
- Aucune erreur de table sur une base vierge et imports terminés.
- Découverte des assistants vérifiée ou état optionnel clairement géré.
- Canal de mise à jour de validation cohérent et 404 expliqué ou supprimé.
- Provenance/version du nouvel artefact explicitement reliées au commit et aux composants embarqués.
- Maintenir la méthode d’installation `install.ps1` souhaitée par le mainteneur ; vérifier qu’elle distribue la version corrigée si elle utilise cet installateur.