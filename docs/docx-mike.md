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
