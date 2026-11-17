---
name: okf
description: Gérer l'index OKF du dossier (.piecemaker/okf/) — fiches de documents, fiches Premise (prémisse : fait ou clause) et Partie, liens cités entre pièces selon l'ontologie commune aux dossiers (par défaut amends, responds-to, refers-to, supersedes), vérification de l'index et du graphe. Use when the user asks to read, build, complete or check the case index, the links between documents, the facts, premises, clauses or parties of the case, or the OKF index.
---

# Index OKF

> **Délégation.** Agent principal : lisez l'index librement, mais déléguez l'écriture. Fiches de documents, parties et liens entre pièces → sous-agent `index-maker`. Prémisses d'un programme Catala → sous-agent `premise-maker`, avec le nom du programme. Sous-agent : vous êtes l'exécutant, appliquez ce skill. Sans sous-agent activé dans le dossier, faites le travail vous-même.
>
> Une prémisse ne se crée que pour une condition Catala qui la demande. On la cherche dans les pièces ; on ne l'invente pas.

L'index OKF résume le dossier en fiches Markdown. Il vit dans `.piecemaker/okf/`. L'OKF fait autorité : en cas de doute, il l'emporte sur toute autre note.

## Fiches

Chaque fiche a un frontmatter YAML et un corps Markdown.

| Type | Contenu |
| --- | --- |
| Dossier de premier niveau de l'arborescence (par défaut `Pièces`) | Une fiche par document. |
| `Premise` | Une prémisse : un point établi par des pièces, qui justifie une condition du raisonnement Catala. Un fait du dossier, par exemple « Rupture du contrat ». Une clause d'un contrat, par exemple « Changement de contrôle ». |
| `Partie` | Une personne qualifiée de partie. La fiche porte le code anonymisé, jamais une identité réelle. |

Aucun champ de statut n'existe (projet, signé). Ne l'ajoutez pas.

Les prémisses viennent des colonnes de revue tabulaire marquées « Index du dossier », des sélections de texte de l'avocat dans la visionneuse et de `pm okf link`.

## Liens

1. Un lien part d'une fiche source et pointe vers une fiche cible.
2. Un lien qui part d'une pièce porte une citation mot pour mot de cette pièce. Seul `involves` n'a pas de citation.
3. Le serveur refuse une citation absente de la pièce.

Entre pièces, seules les relations de l'ontologie existent. Elle est commune à tous les dossiers. Lisez-la avec `pm okf ontologie` : chaque relation y donne les types de documents source et cible admis. Par défaut : `amends`, `responds-to`, `refers-to`, `supersedes` (une version remplace une autre). L'avocat seul modifie l'ontologie (onglet Index › Ontologie). Pour suggérer un changement, modifiez `~/.piecemaker/ontologie.json` avec l'outil Edit ou Write (Codex : apply_patch), jamais par le shell : le hook `guard-ontologie` refuse l'écriture, fusionne la modification dans la proposition en attente (`ontologie.proposition.json`) et vous répond ce qui a changé. L'avocat accepte, refuse ou modifie chaque changement. Le serveur refuse un lien hors ontologie.

Une pièce établit une `Premise` par `states` (citation, valeur facultative). Le scan relie une pièce à une `Partie` par `mentions`. Une `Premise` concerne une `Partie` par `involves`, sans citation.

La cible de `involves` est le code d'une partie : `pm okf link "<titre de la prémisse>" involves PERSONNE_PHYSIQUE_01`. Les parties existantes sont les fiches du dossier `_parties/` de l'index. La qualification d'une partie attend l'avocat : il désigne une partie cliente ou adverse dans l'onglet Dossier, vue générale (colonnes Parties clientes et Parties adverses, ou champ Rôle de la fiche). Le `pm okf link` suivant crée la fiche `Partie`. Ne qualifiez pas une personne de partie vous-même ; signalez à l'avocat celle qu'une pièce montre partie.

## Chaîne de justification

1. Un fait d'un programme Catala se justifie par une `Premise` : la fiche `_premises/<titre normalisé>.md`.
2. Une `Premise` se justifie par des pièces citées (`states`).

## Lire et écrire

1. Lisez les fiches directement avec Read et Grep dans `.piecemaker/okf/`.
2. N'écrivez jamais une fiche à la main. Passez par `pm okf`. Un hook refuse toute écriture directe dans `.piecemaker/okf/`, `~/.piecemaker/ontologie.json` et `.piecemaker/arborescence.json`.
3. Avant la première écriture, lisez `references/okf.md` du skill `piecemaker` (`.agents/skills/Skill-PieceMaker/references/okf.md`). Cette référence décrit les sous-commandes à jour.
4. Pour régler les natures et icônes, lisez `pm okf ontologie`. Proposez la liste complète avec `pm okf types --json`. Comme les relations, elle reste une proposition jusqu’à la décision de l’avocat.
5. Le Hérisson lance `pm okf verify` après chaque `pm okf link` ou `unlink` : corrigez chaque erreur qu'il rend, sans relancer la commande.
6. Pour compléter le graphe, lancez `pm okf verify`. La commande liste chaque élément manquant : pièce à examiner, prémisse sans pièce, sans valeur ou sans partie, partie isolée.
7. Pour une pièce à examiner, lisez la pièce entière. Posez le lien qu'un passage justifie. Si aucun passage ne justifie de lien, lancez `pm okf examinee <pièce> --motif "raison en une phrase"`. `pm okf verify` liste alors la pièce en information, plus en manque. Le manque revient si le document change. `pm okf examinee <pièce> --retirer` annule la marque. Ne marquez jamais une pièce que vous n'avez pas lue.

## Règles de conduite

- Conservez les pseudonymes tels qu'ils apparaissent. Ne cherchez jamais l'identité réelle.
- Ne citez jamais sans extrait littéral de la pièce.
- Si deux pièces se contredisent, signalez la contradiction. Ne tranchez pas.
- Si l'index ne contient pas l'information, répondez « je ne sais pas ». N'inventez ni prémisse ni lien.
