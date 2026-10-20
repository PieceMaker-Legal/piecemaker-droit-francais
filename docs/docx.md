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
| `server/piecemaker/docx-document.ts` | Version, contrôle local à l’ouverture et écriture avec contrôle des octets sauvegardés |
| `server/piecemaker/docx-reasoning-check.ts` | Test local du modèle embarqué, sans LLM ni lecture des sources externes |
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
- Route derrière `authenticateToken` (montage `/api/piecemaker`), limitée aux
  `.docx`, chemin résolu contre la racine du projet (même contrôle lexical que
  le file-tree CloudCLI).

Pour un DOCX contenant déjà un modèle lié, le contrôle est lancé à l’ouverture,
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
modèle embarqué ne présente pas cet affichage ; il n’est pas automatiquement lié
au fichier de raisonnement du dossier.

## Préparer un document lié et choisir le modèle de référence

Pour un document déjà lié, **le modèle embarqué dans ce DOCX fait autorité**.
Le fichier `.piecemaker/raisonnement.js` reste la source indépendante pour préparer
de nouveaux documents. Une modification de ce fichier ne remplace jamais le modèle
d’un DOCX existant. Le panneau du document indique cette référence.

L’agent lit le DOCX, cite les paragraphes à suivre et les valeurs dans un petit
fichier JSON, puis utilise :

```sh
pm docx preparer --fichier brouillon.docx --liens liens.json --sortie document-lie.docx
pm docx verifier --fichier document-lie.docx
pm docx comparer --fichier document-lie.docx
pm docx extraire --fichier document-lie.docx --sortie modele-extrait.js
```

Les chemins sont relatifs au dossier de la session ; PieceMaker doit fonctionner.
`preparer` lit le modèle du dossier par défaut (`--modele autre.js` possible),
ajoute les balises sans modifier le texte ni le modèle et ouvre le résultat dans
le volet Fichiers. Les paragraphes doivent être contigus, dans un même parent ;
chaque valeur est cherchée uniquement dans sa clause. Une sélection absente ou
ambiguë, une révision en attente, un champ Word dynamique ou une structure non
prise en charge provoque un refus. Les styles des segments de texte sont conservés.
Le format JSON et son exemple figurent dans le skill `Skill-PieceMaker`.

`verifier` exécute le contrôle local du DOCX, sans LLM, sans changer ses octets et
sans lire le modèle du dossier. `comparer` compare exactement les deux copies du
code et signale leur divergence ; il ne synchronise rien. `extraire` écrit une
nouvelle copie exacte du modèle embarqué. Les sorties doivent être nouvelles :
aucun fichier existant n’est écrasé. `preparer` refuse aussi un DOCX déjà lié,
pour ne pas effacer silencieusement son historique de contrôle.

Le routeur local `docx-reasoning-local.ts` et le workflow
`docx-reasoning-files.ts` limitent ces commandes aux dossiers enregistrés et
contrôlent les chemins réels, y compris les liens symboliques. Cette protection
ne corrige pas le contrôle lexical de l’ancien routeur de l’éditeur.

Les cycles réels de modification et sauvegarde dans Microsoft Word ont été testés
par Luna : les valeurs sont relues et recalculées, les clauses réécrites sont
signalées, le code embarqué reste identique. Voir
[l’audit de préparation et de Word](audits/docx-preparation-word-luna-2026-10-20.md).

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
