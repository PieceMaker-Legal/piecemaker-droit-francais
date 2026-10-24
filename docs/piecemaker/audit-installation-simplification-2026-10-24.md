# Second audit : code mort et simplification de l’installation

Branche `MAJ-continue`, état audité `cf4afa1d`, 24 octobre 2026. Cet audit
complète le travail sur les sept raccords Electron. Il suit les points d’entrée,
les appels et les gardes de plateforme ; un export peu référencé n’est pas
considéré comme du code mort s’il est appelé à l’intérieur de son module.
Aucune correction de production n’est effectuée dans ce rapport.

## À corriger pour fiabiliser les parcours

### 1. Réparation incomplète des certificats Mac — priorité haute, reproduit

`desktop-bootstrap/lib/certificates-darwin.mjs:90` ne vérifie que l’existence
et la durée de validité du certificat public de la CA avant de réutiliser
l’ensemble. Il ne vérifie pas la présence de sa clé ni des certificats dérivés.

Reproduction réelle dans un répertoire temporaire neuf : génération normale,
suppression de la seule clé de CA, nouvel appel. Le résultat annonce
`regenerated: false` et la clé reste absente. Le démarrage compact détecte
pourtant une clé manquante comme une préparation nécessaire. Une réinstallation
peut donc répéter la préparation sans réparer cette absence.

Correction proposée : vérifier la cohérence des fichiers nécessaires avant
réutilisation, puis réparer selon une règle explicite, en tenant compte de la
confiance déjà enregistrée. Ne pas régénérer silencieusement une CA approuvée
sans traiter cette confiance. Ce n’est pas du code mort ; c’est un défaut de
récupération après suppression partielle.

### 2. Chemin Windows depuis les sources incohérent avec NSIS — priorité haute sur ce chemin

`desktop-bootstrap/lib/install.mjs:46` appelle `buildDesktopApp(sourceDir)`
sans activer `windowsInstaller`. `build.mjs:439` utilise `false` par défaut
et la commande à la ligne 498 construit `--dir`. `place.mjs` copie ensuite
cet arbre et enregistre une entrée de désinstallation propre à PieceMaker.
Or `electron/piecemakerUninstall.js:55` exige désormais `Uninstall*.exe` et
refuse le retrait si le désinstalleur NSIS est absent.

La présence de l’exécutable NSIS n’est pas une condition de validation de
l’arbre décompressé. Ce chemin ne garantit donc pas une installation
correctement désinstallable. Le chemin NSIS standard n’a pas ce défaut.
Le constat concerne le code de cette branche ; les anciens tags exécutent
leurs propres scripts historiques, qu’il ne faut pas assimiler à ce code.

Simplification proposée : produire puis exécuter NSIS aussi pour la
construction Windows depuis les sources, ou retirer explicitement ce chemin
client. Ne pas ressusciter un second désinstalleur PowerShell. Le diagnostic
est établi par les appels et gardes, sans construction ni installation Windows.

## Code mort ou chaîne inactive dans les parcours du dépôt

### 3. Archive GLiNER produite en CI sans consommateur standard — gain potentiel important

Dans `desktop-bootstrap/composants/install.mjs:418`, `includeGliner` vaut
`false`. Aucun appel de production trouvé dans le dépôt ne le passe à `true` ;
ce cas n’est activé que par un test. La chaîne
`installGlinerRuntime → installGlinerSnapshot → ensureGlinerArchive` n’est donc
pas atteinte par ces parcours de production.

Pourtant `.github/workflows/release.yml:108` construit et publie encore
l’archive GLiNER, et `publish-npm` l’attend à la ligne 125. L’installation
actuelle du modèle passe par les étapes de l’installateur vendored et
`warmup.py`, qui appelle `huggingface_hub.snapshot_download` avec la révision
épinglée. Cette chaîne n’utilise pas l’archive de release.

Décision proposée : soit raccorder réellement l’archive au téléchargement du
modèle, soit supprimer la production et l’attente de cet artefact, puis retirer
le client d’archive devenu sans usage. Conserver le checkpoint, ses empreintes,
les modèles et le scan GLiNER. La suppression du modèle ou de sa bibliothèque
n’est pas proposée. L’absence de consommateur est établie dans le dépôt, pas
pour d’éventuels scripts externes inconnus.

### 4. Reliquats du retrait Windows dans le plan désormais utilisé par Mac

`electron/uninstallPlan.js:8-82` conserve la liste des anciens modèles et les
fonctions `hubDirectory`, `modelRepoDirectory`, `repoRootFromModelPath` et
`componentModelPaths`. Leur seul chemin interne est la branche Windows de
`removalPlan` autour de la ligne 154. L’unique appel de production à
`removalPlan` se trouve après le retour de la branche NSIS dans
`piecemakerUninstall.js:55-76` : Windows n’y arrive plus.

Ces recherches de modèles, les raccourcis et le cache Windows de ce plan
peuvent être retirés du parcours de retrait Mac. La lecture de `mineru.json`
à la ligne 78 du lanceur devient également sans effet utile sur Mac.
Conserver les garde-fous de chemins, comptes, Bibliothèque et données Mac.
La constante `WINDOWS_UNINSTALL_KEY` reste appelée par le chemin historique
`place.mjs` : elle ne doit pas être supprimée seule avant la décision du point 2.

### 5. Condition impossible autour de SQLite précompilé — faible ampleur

`desktop-bootstrap/lib/build.mjs:499` teste simultanément `prebuiltSqlite`
et `process.platform !== 'win32'`. Or `downloadPrebuiltSqlite()` retourne
immédiatement `false` hors Windows. La branche ajoutant
`-c.npmRebuild=false` n’est donc jamais exécutée.

Retirer la condition morte ou corriger son intention après vérification de
l’ABI de tous les modules natifs concernés. Ne pas désactiver globalement leur
reconstruction uniquement parce que SQLite est déjà compilé.

## Simplifications possibles, sans suppression immédiate

### 6. Mac télécharge encore tout le dépôt et un Node de bootstrap

`desktop-bootstrap/install.sh:43-76` récupère les sources, puis un Node si
nécessaire, avant de pouvoir télécharger l’application précompilée. Le build
local a été évité lorsque l’asset existe, mais ces deux étapes restent actives.

Cible : télécharger et vérifier le bundle d’abord, puis utiliser le Node
embarqué et des scripts de préparation livrés dans l’application. Ce n’est pas
un retrait de quelques lignes : `prepare-installed.mjs` est actuellement conçu
pour le paquet Windows, et les scripts de préparation Mac ne sont pas encore
livrés par ce même contrat. Préserver signature locale et Python commun.

### 7. Conservation sans borne des versions de caches et des sources

Les composants SDK sont indexés par contenu ; Python est indexé par empreinte
d’archive. Le code nettoie les fichiers temporaires mais pas les anciennes
identités non sélectionnées. `bootstrap/src/<tag>` et les artefacts préchargés
s’accumulent également.

Ce sont des caches de compatibilité et de retour arrière, pas des venv personnels
à effacer. Définir une rétention fondée sur la propriété, protégeant les
versions réellement utilisées par les installations coexistantes. Cela
réduirait l’occupation disque, sans remplacement du cache SDK par CloudCLI.

### 8. Marqueur de confiance écrit mais jamais consulté

`trusted.json`, défini dans `paths.mjs:28`, est écrit dans `install.mjs` et
`prepare-installed.mjs`. Aucun lecteur n’a été trouvé dans le dépôt ; le vrai
contrôle de confiance utilise `isCaTrusted()`.

Faible gain : supprimer cet état redondant s’il n’a pas de rôle de diagnostic
souhaité, ou le traiter explicitement comme un journal, sans lui donner autorité
sur la confiance du système.

### 9. Régénération de tous les lanceurs Python lors de la réutilisation

`composants/install.mjs:376` exécute `sharedPythonEntrypoints` même quand le
runtime vérifié est réutilisé. Ce script recrée tous les `console_scripts`
installés, pas seulement les lanceurs employés par PieceMaker.

Optimisation possible : régénérer après extraction/déplacement, puis contrôler
les lanceurs requis lors de la réutilisation. Aucun gain chiffré n’est établi.
Il ne faut pas supprimer la régénération après déplacement : elle corrige un
vrai problème de chemins. Cette étape ne s’exécute pas à chaque démarrage
normal lorsque la préparation initiale n’est pas nécessaire.

## Vérification et ordre recommandé

- Analyse des appels de production et des gardes, y compris les scripts vendored,
  les workflows et les lanceurs shell/PowerShell ; les références de test sont
  distinguées des appels de production.
- Défaut de CA partielle reproduit avec de vrais certificats temporaires, sans
  modification du trousseau ou de l’application de l’utilisateur.
- 21 tests ciblés réussis : préparation précompilée Mac, réutilisation Python,
  retrait Mac et délégation NSIS simulée. Aucun test ignoré dans cet ensemble.
- Aucun build Vite ni installation Windows réelle dans cet audit.

Ordre proposé : fiabiliser certificats et chemin source Windows ; décider du
sort de l’archive GLiNER ; retirer les reliquats de retrait et la condition
impossible ; simplifier ensuite le bootstrap Mac et la rétention. Conserver
les couches SDK/ASAR dont la nécessité a été démontrée par les essais précédents.
