---
name: okf
description: Gérer l'index OKF du dossier (.piecemaker/okf/) — fiches de documents, fiches Fait et Partie, liens cités entre pièces (amends, responds-to, refers-to, supersedes), vérification. Use when the user asks to read, build, complete or check the case index, the links between documents, the facts or the parties of the case, or the OKF index.
---

# Index OKF

L'index OKF résume le dossier en fiches Markdown. Il vit dans `.piecemaker/okf/`. L'OKF fait autorité : en cas de doute, il l'emporte sur toute autre note.

## Fiches

Chaque fiche a un frontmatter YAML et un corps Markdown.

| Type | Contenu |
| --- | --- |
| Dossier de premier niveau de l'arborescence (par défaut `Pièces`) | Une fiche par document. |
| `Fait` | Un fait du dossier, par exemple « Rupture du contrat ». En due diligence, un point de contrôle, par exemple « Changement de contrôle ». |
| `Partie` | Une personne qualifiée de partie. La fiche porte le code anonymisé, jamais une identité réelle. |

Aucun champ de statut n'existe (projet, signé). Ne l'ajoutez pas.

Les faits viennent surtout des colonnes de revue tabulaire marquées comme « fait » et des sélections de texte de l'avocat dans la visionneuse.

## Liens

1. Un lien part d'une fiche source et pointe vers une fiche cible.
2. Un lien qui part d'une pièce porte une citation mot pour mot de cette pièce, sauf `mentions`.
3. Le serveur refuse une citation absente de la pièce.

Entre pièces, quatre relations existent : `amends`, `responds-to`, `refers-to`, `supersedes`. `supersedes` signifie qu'une version remplace une autre.

Une pièce établit un `Fait` par `states` (citation, valeur facultative). Le scan relie une pièce à une `Partie` par `mentions`. Un `Fait` concerne une `Partie` par `involves`, sans citation.

## Lire et écrire

1. Lisez les fiches directement avec Read et Grep dans `.piecemaker/okf/`.
2. N'écrivez jamais une fiche à la main. Passez par `pm okf`.
3. Avant la première écriture, lisez `references/okf.md` du skill `piecemaker` (`.agents/skills/Skill-PieceMaker/references/okf.md`). Cette référence décrit les sous-commandes à jour.
4. Après toute écriture, lancez `pm okf verify`. Corrigez chaque erreur et relancez jusqu'à zéro erreur.

## Règles de conduite

- Conservez les pseudonymes tels qu'ils apparaissent. Ne cherchez jamais l'identité réelle.
- Ne citez jamais sans extrait littéral de la pièce.
- Si deux pièces se contredisent, signalez la contradiction. Ne tranchez pas.
- Si l'index ne contient pas l'information, répondez « je ne sais pas ». N'inventez ni fait ni lien.
