# Raisonnement du dossier

L’agent répond à une question juridique sur le dossier, puis transcrit sa réponse en code dans `.piecemaker/raisonnement.js`. La commande `pm raisonnement verifier` (skill `piecemaker`, outil MCP `raisonnement`) lit ce fichier, vérifie chaque source et chaque pièce, exécute le test et renvoie le même objet annoté. Le volet **Raisonnement** affiche le graphe, le détail de chaque nœud, les alertes et le code.

## Le fichier

Un objet JavaScript **sans fonctions** : objets, listes, textes (de préférence entre accents graves, pour les citations), nombres, `vrai`/`faux`, `null`. Il n’est jamais exécuté : `format.ts` le lit avec `acorn` et refuse tout ce qui n’est pas une valeur (fonction, appel, variable, `${…}`, commentaire, clé en double).

- `questions: [{ question, reponse }]` — la question posée et le terme qui y répond.
- Une clé par **terme** : `{ si: [...], sauf: [...] }`. Toutes les conditions `si` sont requises ; une seule condition `sauf` vraie écarte le terme. `l_une: [...]` regroupe des conditions dont une seule suffit.
- Chaque condition porte `selon: [{ source, citation, vigueur: { debut, fin, au }, applicabilite }]` (au moins une source) et, pour un fait, `preuve` / `contredit: [{ piece, citation }]`.
- **Affinage** : une condition obscure reçoit sa propre clé, sourcée par l’arrêt, la clause ou l’article qui la précise. Une condition sans clé est un fait.
- **Délais et montants** : une condition nommée peut porter `delai: { de, a, au_plus | au_moins: { jours | jours_ouvres | mois | ans: n } }` ou `montant: { valeur, plus_de | au_moins | moins_de | au_plus: nombre ou nom }`. Elle n’a pas de preuve : sa valeur se calcule à partir de `valeurs: { nom: { valeur: 'AAAA-MM-JJ' | nombre, preuve } }`, une valeur ne comptant qu’avec une preuve vérifiée. `a` est obligatoire : aucune date implicite. Le calcul est calendaire (fin de mois ramenée au dernier jour, jours ouvrés = lundi à vendredi)  ; son calcul est un contrôle (`decompte`), dont l’absence est un manque — le système ne choisit jamais la règle.
- `essais: [{ nom, faits, attendu }]` — le droit seul, rejoué sur des faits supposés ; `faits` accepte aussi les dates et montants des calculs.

`source` est l’identifiant officiel : `LEGIARTI…` (article), `JURITEXT…`, `CETATEXT…`, `CONSTEXT…` (décision), ou le chemin d’une pièce pour une clause. Les connecteurs (`server/piecemaker/reasoning-connectors.ts`) se choisissent selon la forme de l’identifiant ; un identifiant d’un autre droit (CELEX, ECLI…) est accepté et signalé « non vérifiable automatiquement » jusqu’à l’ajout d’un connecteur.

## La fonction test

`engine.ts` traduit l’objet en fonction `test(faits)` construite par le serveur (logique à trois valeurs : vrai, faux, à établir), exécutée sur les faits du dossier pour chaque question et sur les faits supposés de chaque essai.

- Un fait vaut vrai avec une `preuve` vérifiée, faux avec un `contredit`, à établir sinon ou s’il a les deux (contesté). Une pièce marquée non fiable par l’avocat ne prouve rien.
- Les **contrôles** sont des sous-raisonnements : des termes ordinaires (`si`, `sauf`, `l_une`, sources, preuves, délais), désignés par un emplacement et nommés avec son préfixe, que le parseur vérifie dans les deux sens. L’élément qu’ils conditionnent ne compte que si le contrôle est acquis ; leurs faits peuvent devenir décisifs.

  | Emplacement | Sur | Préfixe | Manque quand il manque |
  |---|---|---|---|
  | `applicabilite` | une source | `applicabilité_` | texte (hors arbre d’applicabilité, pas de régression à l’infini) |
  | `decompte` | un délai | `décompte_` | tout délai |
  | `validite` | une question | `validité_` | raisonnement contractuel |
  | `prescription` | une question | `prescription_` | raisonnement contentieux |

  Le vérificateur renvoie le fichier dans l’ordre canonique : `bilan`, `qualification`, `questions`, les termes du raisonnement en descendant depuis chaque réponse, puis les contrôles (applicabilités, décomptes, validité, prescription), `valeurs` et `essais` ; dans chaque objet, identité, fondement, contrôles, faits. Le manque propose le nom du contrôle ; `bilan.controles` compte les contrôles établis. Le volet les colore à part et les liste sous la question. Rien n’en est dit à l’agent.
- La **vigueur est une condition** : une condition n’est remplie que si l’une de ses sources (texte ou clause) est en vigueur à la date que désigne `vigueur.au` (une date de `valeurs`, prouvée). Une clause sans date est tenue pour applicable ; un texte sans `au` laisse la condition à établir. Les décisions n’ont pas de vigueur.
- Quand la réponse est à établir, les **faits décisifs** sont ceux dont la valeur change la réponse (énumération jusqu’à 12 faits inconnus ; au-delà, « en jeu »).

## Ce que renvoie `verifier`

L’objet de l’agent, avec en tête `bilan` (`erreurs`, `manques`, `essais`, `ecartees`, pièces à évaluer, registre) et, sur chaque nœud, `statut` (`acquis`, `exclu`, `à établir`, `contesté`), `decisif`, `erreurs` et `manques` rédigés comme des consignes ; sur chaque source `titre` et `en_vigueur` ; sur chaque pièce `titre`, `nature`, `fiable`, `personnes`. Les annotations recopiées dans le fichier sont ignorées et recalculées.

- **Citation** : retrouvée mot pour mot à la ponctuation, la casse et les accents près, elle est validée, remplacée par l’original dans le fichier et marquée `corrigee` ; sinon erreur.
- **Vigueur** : absente, c’est un manque (avec les dates de la version citée quand Légifrance les donne) ; différente de Légifrance, une erreur.
- **Erreurs** : syntaxe, délai ou montant mal écrit, prouvé sur la condition ou appliqué à une valeur du mauvais type, condition sans source, source ou pièce introuvable, citation introuvable, vigueur fausse, aucune source en vigueur, terme de réponse non défini, boucle, essai non conforme.
- **Manques** : raisonnement non qualifié (`qualification: 'contractuel' | 'contentieux'`, non affichée dans le volet) ; une fois qualifié, « vérifier la validité » (contractuel) ou « vérifier la prescription » (contentieux), volontairement génériques et absents des instructions de l’agent ; délai sans décompte, applicabilité d’un texte non établie, applicabilité dans le temps d’un texte non établie (`vigueur.au` absent, ou date de `valeurs` sans preuve — volontairement absent des instructions de l’agent), vigueur non renseignée, source non vérifiable, fait décisif sans pièce, terme qui ne sert à aucune question.
- **Personnes** : les personnes et sociétés du graphe du dossier citées dans une question ou dans la citation d’une pièce y sont rattachées ; les sociétés rattachées sont contrôlées au Registre Public et au BODACC.

## Décisions de l’avocat

Dans le volet, l’avocat peut **écarter** une alerte (table `pm_reasoning_dismissed`) : elle n’est plus émise, reste listée et peut être rétablie ; son identifiant dépend du type, du chemin et du texte, si bien qu’elle revient quand l’élément change. Il marque chaque pièce **fiable** ou **non fiable** (table `pm_reasoning_reliability`). L’outil `sql` refuse toute écriture dans les tables `pm_reasoning_*`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `server/modules/piecemaker-reasoning/format.ts` | lecture `acorn`, validation, impression de l’objet annoté |
| `server/modules/piecemaker-reasoning/engine.ts` | fonction test, faits décisifs, essais |
| `server/modules/piecemaker-reasoning/program.ts` | vérification, annotations, service, exemple fictif |
| `server/modules/piecemaker-reasoning/routes.ts` | `GET /`, `GET /example`, `POST /verify`, `/dismiss`, `/reliability`, route locale de l’agent |
| `server/piecemaker/reasoning-connectors.ts` | Légifrance, pièces du dossier, registre, BODACC |
| `server/piecemaker/legal-code/instructions.md` | instruction de l’agent, avec l’exemple |
| `plugins/piecemaker-raisonnement/src/client.ts` | volet Raisonnement |

Tests : `npx tsx --tsconfig server/tsconfig.json --test server/modules/piecemaker-reasoning/tests/*.test.ts`.
