---
name: okf
description: Gérer l'index OKF du dossier (.piecemaker/okf/) — fiches de documents, fiches Premise (prémisse : fait ou clause) et Partie, liens cités entre pièces (amends, responds-to, refers-to, supersedes), vérification de l'index et du graphe. Use when the user asks to read, build, complete or check the case index, the links between documents, the facts, premises, clauses or parties of the case, or the OKF index.
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

Entre pièces, quatre relations existent : `amends`, `responds-to`, `refers-to`, `supersedes`. `supersedes` signifie qu'une version remplace une autre.

Une pièce établit une `Premise` par `states` (citation, valeur facultative). Le scan relie une pièce à une `Partie` par `mentions`. Une `Premise` concerne une `Partie` par `involves`, sans citation.

## Chaîne de justification

1. Une condition Catala se justifie par une `Premise` : `source: okf:/_premises/<titre normalisé>.md` dans son `#[doc]`.
2. Une `Premise` se justifie par des pièces citées.
3. Une condition ne cite jamais une pièce directement.

## Lire et écrire

1. Lisez les fiches directement avec Read et Grep dans `.piecemaker/okf/`.
2. N'écrivez jamais une fiche à la main. Passez par `pm okf`.
3. Avant la première écriture, lisez `references/okf.md` du skill `piecemaker` (`.agents/skills/Skill-PieceMaker/references/okf.md`). Cette référence décrit les sous-commandes à jour.
4. Après toute écriture, lancez `pm okf verify`. Corrigez chaque erreur et relancez jusqu'à zéro erreur.
5. Pour compléter le graphe, lancez `pm okf verify`. La commande liste chaque élément manquant : pièce sans prémisse, prémisse sans pièce, sans valeur ou sans partie, partie isolée, `#[doc]` Catala mal relié.

## Règles de conduite

- Conservez les pseudonymes tels qu'ils apparaissent. Ne cherchez jamais l'identité réelle.
- Ne citez jamais sans extrait littéral de la pièce.
- Si deux pièces se contredisent, signalez la contradiction. Ne tranchez pas.
- Si l'index ne contient pas l'information, répondez « je ne sais pas ». N'inventez ni prémisse ni lien.
