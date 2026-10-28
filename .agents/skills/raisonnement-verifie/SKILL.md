---
name: raisonnement-verifie
description: Cadre du raisonnement juridique vérifié de PieceMaker (fichiers .piecemaker/raisonnements/<nom>.yaml, vérificateur, contrôles, volet Raisonnement). Use whenever modifying, reviewing or testing server/modules/piecemaker-reasoning, the agent instruction server/piecemaker/legal-code/instructions.md, or the piecemaker-raisonnement plugin.
---

# Raisonnement vérifié

L'agent transcrit sa réponse juridique dans `.piecemaker/raisonnements/<nom>.yaml` (YAML 1.2 core), seul format lu : un fichier par acte ou par question, nommé d'après son sujet (minuscules, chiffres, tirets). `pm raisonnement lister` les montre avec leurs objectifs et leur dernier bilan ; `--raisonnement <nom>` est requis dès que le dossier en compte plusieurs (verifier, acte). Le serveur garde résultat et alertes écartées par raisonnement, la fiabilité des pièces par dossier ; le volet suit le dernier vérifié et propose un sélecteur. Un ancien `.piecemaker/raisonnement.yaml` ou `.js` est refusé avec la consigne de le déplacer ou le transcrire. Commentaires, tags, ancres, alias et doublons sont refusés. Les fautes d'écriture sont toutes rendues d'un coup, chacune avec sa ligne et sa correction : valeur à mettre entre guillemets (avec la ligne corrigée), ligne mal indentée (avec le niveau sur lequel l'aligner), tabulation, clé en double, clé mal placée (avec le bloc auquel elle appartient) ou mal orthographiée (avec la bonne graphie). Les tests gardent leurs jeux d'essai en objet JS, convertis en YAML par `tests/fixtures.ts` avant vérification. Installer la dépendance locale avec `npm ci --prefix server/modules/piecemaker-reasoning`. Comparatif et protocole : `docs/tests/raisonnement-yaml-luna/README.md`. `pm raisonnement verifier` le vérifie, le teste, le réécrit et renvoie ses erreurs et manques. Le volet Raisonnement montre à l'avocat le graphe, le détail et les alertes.

## Principes (décidés, à ne pas défaire)

- **Une seule source d'instructions** : `server/piecemaker/legal-code/instructions.md`. Elle ne contient que des règles d'écriture génériques et la commande. La skill `piecemaker`, l'outil MCP et le harness des citations ne la répètent pas.
- **C'est le vérificateur qui conduit l'agent** vers un raisonnement complet et sourcé, par ses manques. Les contrôles, la qualification et leurs conséquences ne sont jamais expliqués dans l'instruction.
- **Erreur = défaut d'écriture** (syntaxe, citation introuvable, terme non défini, hypothèse non conforme…). **Manque = ce qui reste à établir** ; l'avocat peut l'écarter. **Conseil = écriture d'un nom à revoir** (même fait sous deux noms, « et »/« ou »/« sauf » dans un nom) : jamais bloquant, absent du bilan, des annotations et du volet, montré à l'agent seulement sans erreur, 5 au plus (`names.ts`).
- **Générique** : aucune règle ne dépend d'un domaine ou d'un vocabulaire (« annexe », « contrat »…). L'agent déclare, le vérificateur vérifie.
- **Souplesse** : un manque désigne où se prononcer, jamais quoi répondre. Ne pas pousser le modèle à combler pour combler.
- **Le raisonnement est orienté par l'objectif** : comme un avocat, l'agent sert l'objectif du client et discute l'interprétation des textes pour l'atteindre. Le vérificateur désigne ce qui y fait obstacle, jamais il ne dispense de preuve ou de citation exacte.
- **Un manque n'est réclamé que s'il est systématique** : il doit se poser pour tout élément ou tout objectif du mode, quel que soit le sujet (la vigueur de tout texte cité ; la prescription en contentieux, où toute action exerce un droit). Ce qui ne se pose que selon le contenu de l'objectif n'est jamais réclamé, puisque le vérificateur ne lit pas ce contenu (la prescription en consultation : « puis-je encore agir ? » oui, « combien d'impôt sur la cession à venir ? » non) : l'emplacement reste disponible et contrôlé, l'agent l'ajoute s'il le juge utile. Avant d'ajouter un manque, vérifier cette règle.
- Le vérificateur ne cite jamais lui-même de texte de référence : il signale ce qui doit être entré.
- Données réelles interdites dans le dépôt (voir `AGENTS.md`) : exemples et tests fictifs.

## Le fichier

- `qualification` : `'drafting'` (faits à prévoir), `'contentieux'` ou `'consultation'` (faits à prouver ; la consultation suit les règles du contentieux, sauf la prescription). Non affichée dans le volet.
- `objectifs: [{ objectif, obtenir | écarter | réduire | augmenter: nom, validite?, prescription? }]` : le but du client et, par un seul verbe, ce qu'il vise : `obtenir`/`écarter` un terme, `réduire`/`augmenter` un montant de `valeurs` (statut + `montant_calcule`). Verbe absent, en double ou inadapté au type = erreur ; les anciennes clés `questions`, `question`, `reponse` = erreurs qui disent quoi renommer. Annotations : `atteint` (vrai/faux, en suspens), `obstacles`.
- Noms : français courant, mots séparés par une espace (`versement de l'indemnité`), lettres, chiffres, `'`, `.`, `-` admis ; l'ancienne écriture avec `_` reste lue. Pas de double espace ni d'espace finale.
- Un terme par clé : `{ si: [...], sauf: [...] }` ; `l_une` = une condition suffit. Une condition de règle s'écrit toujours avec sa valeur attendue : `- nom: true` ou `- nom: false` (exactement une clé non réservée, booléenne ; avec au besoin `selon`, `delai`, `montant`, `decompte`) ; elle est remplie si la valeur de `nom` égale la valeur attendue (trois valeurs : `null` reste `null`). L'ancienne forme `condition: nom`, `preuve` ou `contredit` sur une condition de règle sont des erreurs de migration qui disent où écrire.
- Une question se prouve à la racine : `nom: { true: [fondements], false: [fondements] }` (l'une ou l'autre liste). Fondement = `{ preuve?: [{ piece, citation }], selon?: [sources], si?: [- autre: true] }`, au moins `preuve` ou `selon`. Actif si (une preuve vérifiée ou une source valide, comme pour toute source) et toutes ses conditions `si` remplies ; inactif si l'un est faux ; incertain sinon (le doute se propage : la question reste ouverte). Valeur : actifs seulement côté true → true ; seulement côté false → false ; actifs des deux côtés → `null`, statut `disputé`, manque automatique « fondements contraires, à trancher » ; aucun actif → à établir. Une clé racine ne mêle pas `si`/`sauf` et `true`/`false`. Un nom par question, nommé positivement ; une preuve va sous la valeur qu'elle établit ; le moteur, pas l'agent, repère la contradiction. Les `hypotheses` peuvent fixer une question (`nom: true|false`). `contredit` n'existe plus (condition, source, fondement, valeur : erreur de migration).
- `selon: [{ source, citation, vigueur: { debut, fin, au }, applicabilite, validite, renvoi }]` : identifiant officiel (LEGIARTI, JURITEXT, CETATEXT…) ou chemin de pièce pour une clause ; citation exacte. `renvoi: [{ piece, citation? }]` = ce à quoi la stipulation renvoie (déclaré par l'agent, quel que soit le mot employé). Une stipulation contraire = deux fondements de valeurs opposées sur la même question.
- Délai : `delai: { de, a, au_plus | au_moins: { jours | jours_ouvres | mois | ans: n } }` + `decompte`. Montant : `montant: { valeur, plus_de | au_moins | moins_de | au_plus: nom }`. Données dans `valeurs: { nom: { valeur, preuve | selon, formule? } }`, `valeur: null` si le dossier ne la fixe pas. `preuve` = pièce (donnée stipulée ou constatée) ; `selon` = texte qui fixe la valeur (taux, seuil, barème), vérifié comme toute source (citation, vigueur à la date `au`, applicabilité) ; une pièce en `selon` est une erreur.
- `formule` calcule un montant (sans valeur prouvée, la formule le donne ; avec, les deux doivent concorder) : `somme | difference | produit | quotient | minimum | maximum: [termes]`, `arrondi: [montant, décimales]`, `bareme: { assiette, tranches: [{ jusqu_a, taux }, …, { taux }] }` (progressif), `{ si: terme, alors, sinon }` (montant selon un régime ; terme à trois valeurs). Nombres écrits dans une formule sans `preuve` ni `selon` = manque.
- `hypotheses: [{ nom, faits, attendu }]` : cas supposés que le moteur rejoue (l'ancienne clé `essais` est une erreur qui demande de la renommer) ; un fait absent reprend sa valeur établie ; `attendu` porte sur un terme (vrai/faux) ou un montant (nombre). Une hypothèse non conforme est une erreur : le raisonnement ne dit pas ce que l'agent conclut.
- Variables : une valeur ouverte (`null`) n'est signalée que si une réponse en dépend (fait décisif calculé, ou opérande d'un montant-réponse). En drafting et en consultation, le manque se lève en fixant la valeur ou par des hypothèses qui la supposent : pour un terme, des hypothèses conformes donnant des résultats différents (la bascule) ; pour un montant, une hypothèse conforme qui donne le montant attendu. En contentieux, seule la preuve le lève. Un fait vrai/faux décisif sans pièce n'est jamais levé par une hypothèse hors drafting. Aucune détection textuelle des blancs.
- Simulation (volet, onglet Détail de l'objectif) : l'avocat modifie les valeurs, `POST /reasoning/simulate` rejoue le raisonnement hors ligne (sources en cache du dernier test), rien n'est écrit.

## L'acte rédigé (`acte`)

Le raisonnement est la seule source de l'acte : la rédaction vit dans la clé `acte` du même fichier ; le DOCX n'en est que l'impression.

- `acte: [{ id, intitule, traite, texte: [paragraphes], conflit, sections }]`, dans l'ordre de lecture, distinct de l'ordre logique des termes (un fait sert plusieurs conditions, l'acte le raconte une fois). `traite` (nom ou liste) relie la section à un terme, une condition ou une valeur ; les sous-sections en héritent pour le contrôle des citations. `**gras**` et `*italique*` seuls. Les `id` (`s1`…) sont attribués par le vérificateur et relient les sections aux contrôles de contenu du DOCX.
- Contrôles, sans lecture du sens de la prose : `traite` inconnu = erreur ; passage entre « » (trois mots ou plus) absent des `preuve` et `selon` de ce que la section traite (ou de tout le raisonnement si rien n'est traité) = erreur ; `conflit` = erreur ; section qui développe un point à établir ou disputé = manque ; objectif non développé, obstacle non discuté = manque.
- `pm acte exporter --sortie F.docx [--modele cabinet.docx]` : refusé tant qu'une erreur porte sur l'acte. Chaque section devient un contrôle de contenu verrouillé `pma:sN` ; la base de fusion (texte exporté) est une propriété `PieceMakerActe`. Réexporter vers un DOCX existant reprend son package (styles, en-têtes, mise en page) ; refusé si ce DOCX porte des retouches non fusionnées.
- `pm acte fusionner --fichier F.docx` : fusion à trois voies par section (base du DOCX, modèle, DOCX), texte par `git merge-file --diff3` sur un paragraphe par ligne, conflits affinés paragraphe par paragraphe. Paragraphes et titres ajoutés par l'avocat repris à leur place ; section supprimée reprise si le modèle ne l'a pas changée. Un vrai conflit garde la version du modèle et ajoute `conflit`. Refusé si suivi des modifications, tableau, image, note ou zone de texte (perdus à la réimpression). Après la fusion, la base enregistrée dans le DOCX avance au texte lu (seule la propriété change) : une retouche écartée par l'agent ne revient pas et n'empêche pas la réimpression. Repères : contrôle de contenu et signet `pma_sN` (LibreOffice retire les contrôles de contenu de bloc, garde les signets) ; sans aucun repère, la fusion est refusée plutôt que de dupliquer l'acte. Le dossier versionné (historique) garde la version d'avant.
- `pm acte importer --fichier F.docx` : reprend un acte sans lien ; titres par styles, sinon par numérotation en gras (I., A., 1., a.) ou majuscules. L'agent transcrit ensuite le raisonnement et les `traite` ; les citations de l'acte non retrouvées sont signalées.
- Limites : mise en forme autre que gras/italique, commentaires Word, alignements et retraits propres à un paragraphe ne sont pas conservés ; un `*` littéral est lu comme italique ; l'ordre des sections est celui du modèle.

## Contrôles (sous-raisonnements)

Termes ordinaires désignés par un emplacement, nommés avec son préfixe suivi d'une espace ou de `_` (vérifié dans les deux sens). Les noms suggérés suivent l'écriture du fichier : espaces dès qu'un nom en contient une, `_` sinon. L'élément conditionné ne compte que si le contrôle est acquis.

| Emplacement | Sur | Préfixe | Réclamé |
|---|---|---|---|
| `applicabilite` | source texte | `applicabilité` | tout texte, sauf cité dans un arbre d'applicabilité |
| `validite` | source clause | `validité` | toute clause, sauf citée dans un arbre de validité ou d'applicabilité ; distinct de la validité de l'acte ; doit citer un texte |
| `decompte` | délai | `décompte` | tout délai |
| `validite` | objectif | `validité` | drafting (sauf objectif qui porte sur la validité) |
| `prescription` | objectif | `prescription` | contentieux seulement ; ailleurs facultatif |

Exemptions = garde-fous contre la régression à l'infini (validité → texte → applicabilité → clause sans nouvelle validité).

## Manques par mode

- **Tous** : non qualifié ; valeur ouverte dont dépend une réponse ; renvoi vers un élément absent du dossier ou un passage introuvable ; question disputée (fondements contraires : à trancher ; en drafting, à harmoniser) ; montant stipulé différent de sa formule ; texte sans `vigueur`, sans `vigueur.au` ou date non prouvée ; version non en vigueur ; clause qui renvoie à un article sans ce texte ; donnée de calcul non déclarée ; valeur non nulle sans preuve ; seuil en dur ; source non vérifiable ; terme inutile ; **obstacle à un objectif** : fait établi ou source dont la seule bascule rapproche l'objectif (pour un montant, via les conditions `si` de ses formules), à son emplacement, avec les objectifs que cette bascule éloignerait (« en tension : à arbitrer ») ; objectif contraire sans obstacle unique (chercher un autre fondement, une exception).
- **Drafting** : faits supposés, pas de manque de preuve ; chaque objectif a une hypothèse ; une valeur ouverte décisive se lève par des hypothèses.
- **Contentieux / consultation** : fait décisif sans pièce ; valeur ouverte décisive (en consultation, levée aussi par des hypothèses).
- **Contentieux** : prescription de chaque objectif.

## Sortie de `verifier`

- À l'agent : uniquement erreurs puis manques, numérotés, chacun avec son emplacement (`terme › si[0] › selon[1] › validite`), sa ligne, le contenu de la ligne (ou où l'ajouter) et la consigne. Pas de réponses ni de statuts.
- Le fichier est réécrit dans l'ordre canonique (qualification, objectifs, termes en descendant, contrôles regroupés, valeurs, hypothèses) et imprimé pour grep : un terme par en-tête à deux espaces, une source ou preuve par ligne. L'agent relit avec grep/sed.
- Au volet : l'objet annoté complet (statuts, décisifs, `bilan.controles`, vigueur, pièces). L'avocat écarte des alertes et note la fiabilité des pièces (tables `pm_reasoning_dismissed`, `pm_reasoning_reliability`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `server/modules/piecemaker-reasoning/document.ts` | sélection du fichier et codec YAML/JS, lignes des diagnostics |
| `server/modules/piecemaker-reasoning/format.ts` | lecture acorn, validation, contrôles, ordre canonique, impression |
| `server/modules/piecemaker-reasoning/engine.ts` | logique à trois valeurs, questions et fondements, faits décisifs, délais, hypothèses |
| `server/modules/piecemaker-reasoning/program.ts` | vérification, manques, sortie, service, exemple fictif |
| `server/piecemaker/reasoning-connectors.ts` | Légifrance, pièces, registre, BODACC |
| `server/piecemaker/legal-code/instructions.md` | instruction de l'agent (seule source) |
| `server/modules/piecemaker-reasoning/acte.ts` | lecture de `acte`, id, gras/italique, contrôles de l'acte |
| `server/piecemaker/acte-docx.ts` | export et lecture DOCX (contrôles de contenu, base de fusion, import) |
| `server/piecemaker/acte-merge.ts` | fusion à trois voies (`git merge-file`) |
| `server/piecemaker/acte-files.ts`, `acte-local.ts` | commandes `pm acte` |
| `plugins/piecemaker-raisonnement/src/client.ts` | volet (onglet Acte) |

## Tester

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/piecemaker-reasoning/tests/*.test.ts server/piecemaker/tests/acte-docx.test.ts` (Node 24 via nvm).
- Test de bout en bout : un agent léger (Haiku) ne reçoit que `instructions.md` et un dossier anonymisé, boucle sur `verifier` jusqu'à zéro erreur ; on inspecte le fichier et les manques restants. Ne jamais lui expliquer les contrôles.

## En suspens (proposé, non validé)

Relecture du document lui-même (définitions, désignations, chiffres en lettres, numérotation, blancs à remplir) : outil séparé, non décidé. Options de rédaction (clause présente ou non) : seulement par un fait vrai/faux sans source. Verbe neutre `établir` (sans manque d'obstacle) : à ajouter directement si un test montre qu'un agent s'invente un intérêt sur une demande purement informative. Objectifs sur une date (avancer, retarder) et sur une durée : non couverts tant qu'un cas réel ne le demande pas (la durée d'un délai n'est pas encore une valeur nommée). Connecteur BOFiP. Contrôles propres au contentieux (recevabilité, compétence, délais de procédure).
