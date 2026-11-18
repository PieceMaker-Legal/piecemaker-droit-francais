# Ciblage pour le chat

L'avocat désigne un élément d'un volet. L'élément s'affiche en pastille au-dessus du champ du chat. À l'envoi, le message reçoit un lien vers le fichier source et les lignes de cet élément. L'avocat lit le titre ; l'agent lit le fichier, les lignes et la note.

## Utilisation

1. Cliquer sur le bouton de ciblage de l'en-tête du volet (`PanelPickButton`), ou sur un bouton « ? » propre au volet.
2. Cliquer sur l'élément voulu. Échap annule.
3. Écrire la question, puis envoyer.

Sur petit écran, le volet se ferme après le ciblage et le chat s'affiche avec la pastille.

## Marquer un volet

- Le conteneur du volet porte `data-chat-tab="<identifiant de l'onglet>"`.
- Chaque élément ciblable porte `data-chat-pick="<titre>"`, et au besoin `data-chat-kind` (nature affichée : Relation, Document…), `data-chat-file` (chemin), `data-chat-line`, `data-chat-end` (lignes) et `data-chat-note` (consigne à l'agent).
- Le bouton de ciblage ne s'active que pour un onglet de `PICKABLE_TABS` qui contient des éléments marqués.

Le message reçoit : ``[Nature « titre »](fichier:ligne "lignes N à M") — note``.

## Volets marqués

| Volet | Éléments |
|---|---|
| Catala | cartes (ciblage propre, événement `piecemaker:catala-card-pick`) |
| Index › Ontologie | l'ontologie entière, chaque relation (`ontologie.json` et ses lignes) |
| Index › Classement | l'arborescence entière, chaque dossier (clé `arborescence` de `ontologie.json` et ses lignes) |
| Index › Chronologie | chaque document (fichier de la pièce) |
| Index › Graphe | le graphe entier (`index.md`), la fiche ouverte (fichier de la fiche ou de la pièce), chaque pièce source ou citation |

## Événements

| Événement | Rôle |
|---|---|
| `piecemaker:panel-pick` `{tab}` | démarre ou arrête le ciblage |
| `piecemaker:panel-pick-state` `{tab, active}` | état du ciblage, pour le bouton |
| `piecemaker:chat-pick` | ajoute une pastille (`titre`, `nature`, `fichier`, `debut`, `fin`, `note`, `tab`) |
| `piecemaker:panel-picked` `{tab}` | ciblage fait ; ferme le volet sur petit écran |

## Fichiers

| Rôle | Fichier |
|---|---|
| Pastilles et texte envoyé | `src/modules/piecemaker-chat-picks/chatPickComposer.ts` |
| Ciblage générique | `src/modules/piecemaker-chat-picks/panelPicker.ts` |
| Démarrage | `src/piecemaker/anonymizer/bootstrap.ts` |
| Bouton | `src/modules/piecemaker-workspace-tabs/PanelPickButton.tsx` |

## Commentaire

Le bouton 💬 « Commenter » d'une pastille ouvre, à l'envoi, un fil ancré lu par `FeatureComments`. Détail : `docs/features.md`.

Limite : une pastille seule, sans texte, s'envoie par Entrée, pas par le bouton d'envoi.
