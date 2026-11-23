# Objectifs et parties du dossier

Tout dossier juridique poursuit un ou plusieurs objectifs, avec des parties. PieceMaker les place au centre : raisonnement, recherche, index OKF et rédaction partent d'eux.

## Où

- **Fichier** : `<dossier>/.piecemaker/objectifs.md`, dans le dossier lui-même (pas dans le brain) : il suit le dossier, il n'est jamais pris pour une pièce, et l'agent du dossier comme ses fils le lisent sans accès au brain.
- **Annonce au plus haut niveau** : la règle `0° Objectifs et parties` est la première ligne de l'`AGENTS.md` du dossier, juste sous l'en-tête (`OBJECTIFS_RULE`, `server/piecemaker/agent-instructions.ts`). Elle contient `@.piecemaker/objectifs.md` : Claude, qui lit `AGENTS.md` par l'import de `CLAUDE.md`, charge le fichier à chaque session ; Codex et Mistral lisent la règle et ouvrent le fichier. Un `AGENTS.md` existant reçoit la ligne au balayage des projets (`withObjectifsRule`), une seule fois ; le reste du fichier n'est pas touché. La numérotation des autres règles ne change pas.
- **Sans fichier** : rien n'est créé d'office. La règle demande à l'agent de définir les objectifs avec l'avocat ; `pm check` affiche `0° Objectifs : à définir avec l’avocat`.

## Format

Markdown sans frontmatter, une section `## Objectif : <intitulé>` par objectif. Champs : `Résultat recherché` et `Parties` (obligatoires), `Statut`, `Pour`, `Points à établir`, `Actes`, `Limites` et tout autre champ libre. Modèle complet et règles de tenue : `server/piecemaker/vendor/skills/Skill-PieceMaker/references/objectifs.md` (lu par `Feature read case path=piecemaker/references/objectifs.md`).

Pas de doublon avec la base : une partie s'écrit par son code de l'index (`_parties/<CODE>.md`), avec son rôle dans l'objectif ; son identité reste dans la base du dossier. Un point à établir porte le titre de la prémisse OKF qui l'établira.

## Lien avec l'OKF

L'objectif décide de ce qui compte dans l'index, avant l'ontologie (skill `okf`, « Partir des objectifs ») : ses parties sont celles que les prémisses concernent (`involves`), ses points à établir sont les prémisses à chercher d'abord dans les pièces. L'ontologie ne règle que la forme des liens entre documents.

## Vérification

`pm objectifs verifier` (`scripts/objectifs.mjs` du skill `piecemaker`) :

| Gravité | Cas |
| --- | --- |
| erreur | fichier absent ; frontmatter ; aucun objectif ; objectif sans `Résultat recherché` ou sans partie ; statut hors `en cours`, `en attente`, `atteint`, `abandonné` ; partie écrite par un nom au lieu d'un code ; partie sans rôle |
| manque | code absent de `_parties/` (qualification en attente de l'avocat) ; point à établir sans fiche `_premises/` ; raisonnement de `etapes` (hors `remplacePar`) absent de toute ligne `Actes` |

Dernière ligne : `Objectifs : <N> objectif(s), <E> erreur(s), <M> manque(s).` Le Hérisson (feature `objectifs`, cible `objectifs.md`) le lance après chaque écriture du fichier ; seules les erreurs suspendent la fin de tour. `pm check` en donne l'état au point `0°`.

## Limites

- Le brain n'a pas de copie des objectifs : l'agent central les lit par un fil du dossier.
- Un objectif sans code de partie (partie pas encore qualifiée) reste en manque jusqu'à la qualification par l'avocat.
