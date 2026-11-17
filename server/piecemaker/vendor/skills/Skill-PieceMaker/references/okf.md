# Index OKF (`pm okf`)

L'index du dossier suit le format Open Knowledge Format 0.2. Il vit dans `.piecemaker/okf/`. Il fait autorité sur les liens entre pièces et sur les prémisses. Ne l'écris pas à la main : passe par `pm okf`.

## Fiches

| Fiche | Identifiant | Contenu |
| --- | --- | --- |
| Document | `/<chemin du document>.md` | titre, nature, date, liens |
| Premise (prémisse) | `/_premises/<titre normalisé>.md` | titre, description, pièces qui l'établissent |
| Partie | `/_parties/<CODE>.md` | code de la partie, côté (client ou adverse) |

```markdown
---
type: Pièces
title: Courrier.pdf
description: Courrier
resource: Pièces/Courrier.pdf
date: 2021-06-01
generated:
  by: piecemaker/gliner
  at: 2026-01-01T00:00:00.000Z
relations:
  refers-to:
    - target: /Pièces/Contrat.pdf.md
      citation: Nous faisons suite au contrat de prestation du 12 mars 2021.
      origin: piecemaker/gliner
  states:
    - target: /_premises/date-de-resiliation.md
      citation: Le contrat est résilié à compter du 1er juin 2021.
      value: 2021-06-01
      origin: piecemaker/agent
  mentions:
    - target: /_parties/CLIENT_01.md
      citation: Contrat de prestation conclu entre CLIENT_01 et ADVERSE_01.
      origin: piecemaker/gliner
---
```

- `type` d’un document : champ `type` du dossier, hérité du parent. Sans ce champ, nom du dossier de premier niveau. Un document hors arborescence reçoit `Non classé` ; `verify` le signale.
- Seules les personnes qualifiées de parties ont une fiche. Le scan pose `mentions` ; tu ne l'écris pas.
- Aucun champ de statut (projet, signé) n'existe.

## Liens entre pièces

Les relations admises sont celles de l'ontologie, commune à tous les dossiers (`~/.piecemaker/ontologie.json`), de la source vers la cible. Chaque relation fixe les types de documents source et cible. `pm okf ontologie` les affiche. Par défaut : `amends`, `responds-to`, `refers-to`, `supersedes` (une version remplace une autre), entre documents des types du graphe (par défaut `Pièces`). L'avocat seul modifie l'ontologie (onglet Index › Ontologie). Pour suggérer un changement, modifiez `~/.piecemaker/ontologie.json` avec l'outil Edit ou Write (Codex : apply_patch), jamais par le shell : le hook `guard-ontologie` refuse l'écriture, fusionne la modification dans la proposition en attente (`ontologie.proposition.json`) et vous répond ce qui a changé. `pm okf ontologie proposer --json '{"relations":[…],"motif":"…"}'` propose aussi une liste complète. Chaque relation porte toutes ses clés : `name`, `label`, `inverse`, `description`, `source`, `target`. Une clé absente ou inconnue est refusée. L'avocat accepte, refuse ou modifie chaque changement ; `pm okf link` refuse une relation absente ou un type non admis. Chaque lien porte une citation mot pour mot du document source.

```bash
pm okf ontologie
pm okf link "Pièces/Avenant.pdf" amends "Pièces/Contrat.pdf" --citation "L'article 3 du contrat est remplacé."
pm okf unlink "Pièces/Courrier.pdf" refers-to "Pièces/Contrat.pdf"
```

Ajoute un lien seulement si tu as lu la phrase qui le fonde. Un lien du scan retiré reste écarté.

## Types de documents et icônes

1. Lire `pm okf ontologie` : types principaux, natures et icônes disponibles.
2. Proposer le catalogue commun avec `pm okf types --json '[{"name":"contrat","icon":"pen"}]'`, ou en éditant `ontologie.json` (clé `documentTypes`). Fournir toute la liste, y compris les types conservés. Chaque type porte `name` et `icon`, sans autre clé.
3. La commande valide la liste et l'enregistre comme proposition. L'avocat accepte, refuse ou modifie chaque changement. Corriger les erreurs signalées, puis lancer `pm okf verify`.

Cette commande applique directement les natures et leurs icônes. Les relations et l’arborescence restent des propositions soumises à l’avocat.
Le champ facultatif `type` d’un dossier fixe son type principal. Les sous-dossiers héritent du parent. Sans champ `type`, le nom du dossier de premier niveau reste le type principal.
Supprimer une nature conserve les documents. Leur icône devient générique. Modifier `data_json.nature` avec `pm dossier sql` pour changer la nature d’un document.
Le graphe reprend le titre descriptif de la revue : colonne `Titre`, `Intitulé`, `Titre du document`, ou `Événement` à défaut.

## Prémisses

Une prémisse est un point que des pièces établissent : un fait du dossier, ou une clause d'un contrat. Elle justifie qu'une condition du raisonnement Catala est remplie.

Une pièce établit une prémisse par un lien `states`. La fiche `Premise` est créée si elle manque. Réutilise le titre exact d'une prémisse existante pour rattacher une autre pièce à la même prémisse.

```bash
pm okf link "Pièces/Courrier.pdf" states "Date de résiliation" --citation "Le contrat est résilié à compter du 1er juin 2021." --value "2021-06-01" --single
pm okf link "Date de résiliation" involves CLIENT_01
pm okf unlink "Pièces/Courrier.pdf" states "Date de résiliation"
```

- `--value` : ce que la pièce dit de la prémisse. Écris la même valeur sous la même forme d'une pièce à l'autre (date en `AAAA-MM-JJ`, montant en chiffres).
- `--single` : la prémisse n'a qu'une valeur. Un écart entre pièces devient une contradiction.
- `involves` relie une prémisse à une partie, sans citation. La cible est le code de la partie.
- Sans partie qualifiée dans le dossier, `verify` marque le manque `involves` « attend l'avocat » (champ `avocat: true`) et `pm check` le compte à part. L'avocat désigne une partie cliente ou adverse dans l'onglet Dossier, vue générale. Ne la qualifie pas toi-même ; signale-lui ce manque.

Les colonnes de revue tabulaire marquées « Index du dossier » posent aussi des liens `states`. L'avocat en pose dans la visionneuse.

## Prémisse et raisonnement Catala

1. Une condition Catala se justifie par une prémisse : `source: okf:/_premises/<titre normalisé>.md` dans son `#[doc]`, sans `quote`.
2. Une prémisse se justifie par des pièces citées (`states`).
3. Une condition ne cite jamais une pièce directement.

Pour un contrat, chaque clause utile est une prémisse : titre = objet de la clause, citation = texte de la clause, valeur = ce qu'elle stipule.

## Vérifier

```bash
pm okf verify
```

La commande renvoie les erreurs : type hors arborescence, document absent, document sans fiche, relation inconnue, cible absente ou hors graphe, citation introuvable, `index.md` incomplet. Elle renvoie aussi les contradictions : une prémisse à valeur unique avec plusieurs valeurs. Le Hérisson la lance seul après chaque `pm okf link` ou `unlink` : corrige la cause de chaque erreur qu'il rend. Signale une contradiction à l'avocat ; ne tranche pas.

Elle liste enfin les éléments manquants du graphe ; un manque lié à un programme Catala nomme ce programme :

| Élément | Manque signalé |
| --- | --- |
| Pièce du graphe | pièce à examiner : aucune prémisse établie, aucun lien vers une autre pièce ; ou pièce modifiée depuis son examen sans lien |
| Prémisse | aucune pièce citée ; à valeur unique sans valeur ; aucune partie concernée ; citée par aucun programme Catala (si un programme existe) |
| Partie | aucune mention dans une pièce, aucune prémisse qui la concerne |
| `#[doc]` Catala (`fichier:ligne`) | prémisse absente de l'index ou sans pièce ; pièce citée directement |

Lance `verify` toi-même seulement pour lire les manques du graphe avant de le compléter. Comble chaque manque que les pièces permettent de combler. Signale les autres à l'avocat ; n'invente ni citation ni lien.

Une pièce lue en entier dont aucun passage ne justifie de lien ni de prémisse se marque examinée sans lien, avec la raison :

```bash
pm okf examinee "Pièces/Courrier.pdf" --motif "Courrier isolé : il ne cite aucune autre pièce."
pm okf examinee "Pièces/Courrier.pdf" --retirer
```

La marque est écrite dans la fiche (`examen_sans_lien` : motif, auteur, date, empreinte du document). `verify` liste alors la pièce sous « Examinées sans lien », en information, plus en manque. Le manque revient si le document change ou si la marque est retirée. Ne marque jamais une pièce que tu n'as pas lue.
