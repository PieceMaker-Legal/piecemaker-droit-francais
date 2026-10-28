# Documents Word (`.docx`)

Deux chemins indépendants manipulent les `.docx` : l'**assistant** par le skill
`docx-cli`, l'**avocat** par la visionneuse intégrée. Ils écrivent le même
fichier sur disque ; chacun voit les modifications de l'autre.

## 1. Côté assistant — skill `docx-cli`

| Quoi | Où |
| --- | --- |
| Installation (skill vendu, déclaré dans chaque dossier) | `server/piecemaker/vendor/skills/docx-cli/`, `server/piecemaker/skill-declaration.ts` |
| Usage en rédaction (templates, placeholders, modifications suivies ; déclaré dans chaque dossier) | `server/piecemaker/vendor/piecemaker-plugin/skills/redaction-juridique/SKILL.md` |
| Garde-fou Bash (`docx read pièce.docx` passe par le hook) | `server/piecemaker/vendor/piecemaker-plugin/scripts/protect-originals.mjs` |
| Classement des `.docx` produits par l'IA | `server/piecemaker/vendor/piecemaker-plugin/scripts/classify-ai-documents.mjs` |

- Remplace `document-skills:docx` : le binaire `docx` mute l'OOXML **en place**
  (styles maison, thème et objets embarqués conservés), adresse le contenu par
  localisateurs stables, et expose `docx track-changes` pour les actes à relire.
- Le skill est copié dans `.agents/skills/docx-cli/` de chaque dossier (liens
  Claude, Cursor, OpenCode, Grok). Le binaire `docx` est posé au premier usage
  (`scripts/bootstrap.sh`, version épinglée, SHA-256 vérifié).
- Travaillant entièrement par Bash, il est couvert par `protect-originals.mjs`,
  qui inspecte aussi les commandes shell. Par défaut seuls PDF et images sont
  protégés (`lib/protection.cjs`, `PROTECTED_EXTENSIONS`) : un `.docx` n'est
  protégé que s'il est listé dans `.piecemaker/protection.json`.

## 2. Côté avocat — visionneuse / éditeur intégré

Ouvrir un `.docx` depuis l'arborescence affiche un éditeur Word complet
(`@eigenpal/docx-editor-react`, Apache-2.0, interface `fr`) au lieu du message
« Fichier binaire ».

| Fichier | Rôle |
| --- | --- |
| `src/piecemaker/docx/DocxDocumentViewer.tsx` | Éditeur, rechargement externe, enregistrement automatique |
| `src/piecemaker/docx/index.ts` | `DocxDocumentViewer`, `isDocxDocument` |
| `src/modules/code-editor/CodeEditor.tsx` | **Seul fichier CloudCLI touché** : import + une ligne de branchement, juste avant le rendu binaire |
| `server/piecemaker/docx-document.ts` | Version, contrôle local à l’ouverture, sauvegarde avec `If-Match` et contrôle des octets sauvegardés |
| `server/modules/piecemaker-docx/` | Normalisation OOXML, lecture du mtime et écriture atomique |
| `server/piecemaker/docx-reasoning-check.ts` | Test local du modèle lié, sans LLM ni lecture des sources externes |
| `src/modules/docx-reasoning/` | État du contrôle, passages à revoir, calculs, alertes et relance manuelle |
| `server/piecemaker/index.ts` | Montage du routeur |

Fonctionnement :

- Lecture des octets par l'API CloudCLI existante (`api.readFileBlob`).
- Toutes les secondes, comparaison du `mtime` : si le fichier a changé sur
  disque (par exemple `docx-cli` côté assistant), l'éditeur se recharge.
- Après une frappe ou un clic de l'utilisateur, chaque `onChange` programme un
  enregistrement 800 ms plus tard. `save()` est sélectif par défaut : seules
  les parties modifiées de l'archive sont repackagées. Les sauvegardes sont
  sérialisées pour préserver l’ordre des écritures et de leurs résultats.
- Écriture atomique (fichier `.tmp` puis `rename`), 100 Mo maximum.
- La sauvegarde corrige l’attribut `w:csTheme` émis par l’éditeur en
  `w:cstheme`, conformément au schéma OOXML. Les autres parties du document
  sont conservées ; un fichier valide reste identique octet pour octet. Une
  archive illisible est refusée avant toute écriture sur le document existant.
- Route derrière `authenticateToken` (montage `/api/piecemaker`), limitée aux
  `.docx`, chemin résolu contre la racine du projet (même contrôle lexical que
  le file-tree CloudCLI).

Pour un DOCX contenant déjà une liaison au modèle, le contrôle est lancé à l’ouverture,
après chaque sauvegarde automatique réussie et après rechargement d’une modification
externe. Le `PUT` renvoie `{ version, reasoning }` calculé sur les octets écrits ;
`GET /api/piecemaker/docx-document/reasoning` permet l’ouverture et la relance
manuelle avec une version prise sur le même fichier ouvert que ses octets.

Une retouche masque immédiatement les anciens résultats et affiche « Document
modifié · vérification à actualiser ». Les réponses d’un contrôle antérieur à cette
retouche ou à un changement de document sont ignorées. Les chargements déjà en vol
ne remplacent pas un autre document ouvert entre-temps et les lectures lentes ne
se multiplient pas à chaque cycle de sondage.

Le résultat distingue test local exécuté, passages à revoir et vérification
impossible. Les erreurs du moteur restent visibles dans le statut, et les détails
montrent les calculs, manques et extraits concernés. Le bouton « Relancer le
contrôle » est disponible une fois la sauvegarde et le contrôle terminés. Aucun
statut de validation juridique complète n’est affiché : sources externes, parties
et fiabilité des pièces ne sont pas relues par ce contrôle automatique.

Le modèle et le moteur de raisonnement ne sont pas réécrits. Une erreur de liaison
est signalée séparément et n’annule pas la sauvegarde du DOCX. Un document sans
liaison ne présente pas cet affichage ; il n’est pas automatiquement lié
au fichier de raisonnement du dossier.

## Préparer un document lié et choisir le modèle de référence

Pour les nouveaux documents, **le modèle reste dans le dossier PieceMaker**,
par défaut le raisonnement du dossier dans `.piecemaker/raisonnements/` s'il est unique (sinon `--modele`), seul format YAML lu. Le DOCX ne contient pas son code : il
conserve un chemin relatif au dossier, une empreinte SHA-256 de la version liée,
les balises des valeurs et clauses et leurs empreintes de texte.

À chaque contrôle, PieceMaker lit ce fichier sans l’exécuter et vérifie son
empreinte avant d’appeler le moteur existant. Un fichier absent ou modifié rend
le contrôle impossible ; aucune autre version n’est utilisée silencieusement.
Même une modification de mise en forme du code change son empreinte. Restaurer
la version exacte rétablit le contrôle. L’adoption d’un nouveau modèle demande
un réexamen explicite ; cette commande ne modifie pas le modèle.

Le sondage de l’éditeur suit aussi l’empreinte du fichier externe : si elle
change, il suspend l’ancien résultat et relance le contrôle, sans recharger le
DOCX ni annuler sa sauvegarde programmée. Le fichier du modèle est lu et haché
localement ; le contrôle complet ne tourne qu’après un événement. La référence
extraite du DOCX est mise en cache pour éviter de rouvrir son archive à chaque
sondage.

Les anciens documents avec modèle embarqué restent lisibles et utilisent encore
cette copie. Ils ne sont pas migrés implicitement. Le DOCX externe doit rester
avec son dossier PieceMaker ; le déplacement du dossier complet préserve le
chemin relatif. Renommer ou déplacer le DOCX à l’intérieur de ce dossier ne
change pas sa référence.

L’agent lit le DOCX, cite les paragraphes à suivre et les valeurs dans un petit
fichier JSON, puis utilise :

```sh
pm docx preparer --fichier brouillon.docx --liens liens.json --sortie document-lie.docx
pm docx verifier --fichier document-lie.docx
pm docx comparer --fichier document-lie.docx
pm docx extraire --fichier document-lie.docx --sortie modele-extrait.yaml
```

Les chemins sont relatifs au dossier de la session ; PieceMaker doit fonctionner.
`preparer` lit le modèle du dossier par défaut (`--modele autre.yaml` possible),
ajoute les balises et la référence sans modifier le texte ni le modèle et ouvre
le résultat dans le volet Fichiers. Les paragraphes doivent être contigus, dans un même parent ;
chaque valeur est cherchée uniquement dans sa clause. Une sélection absente ou
ambiguë, une révision en attente, un champ Word dynamique ou une structure non
prise en charge provoque un refus. Les styles des segments de texte sont conservés.
Le format JSON et son exemple figurent dans le skill `Skill-PieceMaker`.

`verifier` exécute le contrôle local du DOCX, sans LLM, sans changer ses octets et
en lisant le modèle référencé dans le dossier. `comparer` confronte son empreinte
à celle enregistrée dans le DOCX ; il ne synchronise rien. `extraire` écrit une
nouvelle copie exacte du modèle lié, seulement si la version attendue est disponible.
Pour les anciens DOCX, la copie embarquée reste la référence. Les sorties doivent
être nouvelles :
aucun fichier existant n’est écrasé. `preparer` refuse aussi un DOCX déjà lié,
pour ne pas effacer silencieusement son historique de contrôle.

Le routeur local `docx-reasoning-local.ts` et le workflow
`docx-reasoning-files.ts` limitent ces commandes aux dossiers enregistrés et
contrôlent les chemins réels, y compris les liens symboliques. Cette protection
ne corrige pas le contrôle lexical de l’ancien routeur de l’éditeur.

Les cycles réels de modification et sauvegarde dans Microsoft Word ont été testés
par Luna : les valeurs sont relues et recalculées, les clauses réécrites sont
signalées. Le premier audit couvrait le modèle embarqué ; la campagne externe est
décrite dans [l’audit de référence externe](audits/docx-reference-externe-luna-2026-10-20.md).

## 3. Défauts connus (audit du 2026-09-26)

1. **Écriture sans garde sur les pièces originales.** L'enregistrement
   automatique s'applique à tout `.docx` du projet, y compris une pièce reçue
   ou un fichier listé dans `protection.json`. Une frappe accidentelle modifie
   l'original sans confirmation. Piste : lecture seule par défaut, bouton
   « Modifier », refus côté route des fichiers protégés.
2. **Perte de frappe sur modification externe.** Si le fichier change sur
   disque pendant la fenêtre de 800 ms, le rechargement annule le minuteur :
   la dernière saisie est perdue, sans avertissement.
3. **Contrôle de chemin lexical uniquement.** Pas de `realpath` : un lien
   symbolique dans le projet pointant hors du projet serait suivi (même
   faiblesse que le file-tree CloudCLI).
4. **Enregistrements concurrents non sérialisés — corrigé dans l’éditeur intégré.**
   Une file d’attente sérialise désormais `save()` et le `PUT` correspondant.
   Les écritures par d’autres programmes restent indépendantes.
5. **Projet absent.** Sans `projectId`, `load()` ne fait rien et l'écran reste
   sur « Chargement… ».
6. **Chaînes en dur.** « Fermer » et « Chargement… » ne passent pas par
   l'i18n.
7. **Sondage permanent.** Une requête par seconde tant qu'un `.docx` est
   ouvert.
8. **Lint.** `react(set-state-in-effect)` sur l'effet de chargement (faux
   positif : l'état est posé après un `await`).
9. **Exception à la règle upstream.** Les 3 lignes de `CodeEditor.tsx` ne sont
   ni de la marque ni de l'isolation ; c'est le seul point d'entrée possible
   pour remplacer le rendu binaire.
10. **Non testé en conditions réelles** lors de la récupération (serveur de dev
    arrêté) : typecheck et lint seulement.
