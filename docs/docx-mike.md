# Révisions DOCX de Mike dans PieceMaker

Le document reste édité directement dans Eigenpal et par les outils DOCX existants.
Aucune commande `pm docx` n’est ajoutée.

Le moteur serveur de Mike écrit les propositions en véritables révisions Word.
La carte affiche le texte avant/après, la justification facultative et les actions Voir, Accepter et Refuser.
La justification reste dans la carte ; elle ne crée pas de commentaire Word.
Les commentaires existants continuent de passer par Eigenpal.

## Code repris

Source : dépôt Mike, commit `f6f45fe6eec17ec033cf29207cfa7ef573d612b3`.

| Mike | PieceMaker | Adaptation |
| --- | --- | --- |
| `backend/src/lib/docxTrackedChanges.ts` | `server/modules/piecemaker-docx/mike/docxTrackedChanges.ts` | Aucune : fichier identique. |
| `packages/ui/src/EditCardUI.tsx` | `src/modules/docx-review/EditCardUI.tsx` | Imports des contrôles, alias de type, libellés français et couleurs du projet. |
| `documents.trackedEdits.ts`, `documents.edits.ts`, `documents.versions.ts` | `server/modules/piecemaker-docx/docx-review.service.ts` | Remplacement de Supabase et du stockage objet par les fichiers du dossier. |
| Outils et cartes du chat Mike | Route `docx-review` et plugin Playbooks | Appels directs du serveur et API Eigenpal déjà installée. |

Le fichier `mike/LICENSE` conserve la licence source.
`fast-xml-parser` est ajouté pour exécuter le moteur sans réécriture.
La visionneuse CloudCLI n’est pas modifiée ; seul le composant Word PieceMaker reçoit le panneau.

## Versions et décisions

Les métadonnées et instantanés résident dans `.piecemaker/word/<identifiant du chemin>/`.
Le fichier ouvert reste la version active.
La première proposition conserve le fichier source, puis crée une version avec révisions.
Chaque lot de propositions crée une version ; accepter ou refuser modifie cette version.
L’éditeur affiche les cartes à droite et permet de consulter les versions précédentes en lecture seule.
Ce contrôle ne change pas la version active.

Playbooks utilise ce même moteur pour « Proposer dans Word » et affiche les cartes de Mike.
La copie revue reste séparée de la pièce source, comme avant cette intégration.
Les sauvegardes ordinaires d’Eigenpal gardent leur fonctionnement existant.
L’historique Git du dossier continue de conserver les modifications directes.

## Éditions directes par docx-cli

Au démarrage, PieceMaker place son adaptateur `docx` avant le binaire personnel dans le PATH du serveur.
Cette installation ne modifie pas le binaire personnel ni les fichiers de configuration du shell.
Les nouvelles sessions héritent de cet environnement ; les sessions déjà ouvertes doivent être rouvertes après le redémarrage du serveur.

L’adaptateur conserve les octets avant modification et lance le vrai binaire sur une copie de préparation.
Il publie le résultat seulement si le document ouvert n’a pas changé pendant la commande.
Il enregistre les versions et les nouvelles substitutions suivies dans le registre commun, sans réappliquer les modifications.
Le panneau Eigenpal existant les affiche lors de son prochain rafraîchissement.
Un verrou local partagé avec les décisions des cartes ordonne les opérations de revue entre processus.

Pour fournir un motif, ajouter `reason` à chaque substitution du lot JSONL :

```json
{"pattern":"90 jours","replacement":"30 jours","reason":"Aligner le délai sur la clause négociée."}
```

La commande reste `docx replace FICHIER --batch LOT.jsonl --track`, ou `--batch -` pour lire l’entrée standard.
Le motif est associé lorsque le texte et l’emplacement désignent une substitution sans ambiguïté.
Les expressions régulières ou motifs normalisés peuvent produire une carte sans motif si cette correspondance n’est pas exacte.

L’adaptateur conserve le code de retour du binaire, y compris lorsqu’un lot partiellement en erreur a déjà produit des modifications.
Il utilise les véritables identifiants OOXML ; les repères CLI `tcN` et `revN` peuvent changer après une décision.
Les révisions préexistantes ne sont pas ajoutées comme propositions de la nouvelle commande.

Les cartes couvrent les insertions et suppressions textuelles simples du corps et des tableaux.
Les révisions structurelles ou de mise en forme restent des révisions natives ; elles ne deviennent pas des cartes de substitution.
Les lectures, aperçus et écritures avec `--output` passent directement au binaire sans enregistrer de cartes.
Les décisions effectuées par le CLI ou les contrôles natifs ne réconcilient pas encore les statuts du registre.
Les commandes exécutées par chemin absolu vers le binaire personnel contournent cet adaptateur.
L’exécution a été vérifiée sur macOS avec docx-cli 0.28.0 ; Windows reste à vérifier.

Code : `server/piecemaker/docx-command.ts`, `docx-cli-entry.ts`, `docx-cli.ts` et `runDirectDocxReview` dans le service de revue.

## Consignes conservées de Mike

Le skill documentaire existant reçoit seulement ces consignes : lire chaque version une fois, modifier les documents ordinaires directement,
dupliquer les modèles, limiter les substitutions et vérifier la numérotation et les renvois concernés.
Le suivi par défaut et l’attribution du fournisseur existaient déjà dans PieceMaker.
La précédente proposition de règle complète n’est pas activée.

## Limites conservées

Le moteur vise les paragraphes du corps et des tableaux ; il ne modifie pas les en-têtes, pieds ou notes.
Un remplacement ne traverse pas plusieurs paragraphes.
Le moteur recherche un ancrage unique et peut normaliser les espaces, comme Mike.
Le code conserve aussi le comportement de Mike sur les révisions préexistantes et les identifiants devenus absents.
Les décisions prises dans les cartes sont persistées ; une décision native Eigenpal ne réécrit pas automatiquement le registre des cartes.
Les révisions natives sans annotation IA continuent d’utiliser les cartes natives Eigenpal.

Les métadonnées cachées ne sont pas ajoutées automatiquement à l’historique Git du dossier.
Le registre local remplace les lignes de base de données de Mike ; il ne constitue pas une transaction entre plusieurs fichiers.
Les versions ne sont pas regroupées automatiquement par tour de conversation.

## Vérification

Les tests utilisent des contrats fictifs et n’appellent aucun modèle.
Le test navigateur de Playbooks ouvre le véritable Eigenpal, écrit des révisions, rouvre la revue et refuse une proposition.
Il vérifie le texte final, la conservation de la pièce source et l’absence de commentaire Word ajouté.
Les tests serveur couvrent les versions, décisions, conflits, ancrages et limites du dossier.
