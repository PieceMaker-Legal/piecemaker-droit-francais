# Objectifs et parties du dossier

Tout dossier poursuit un ou plusieurs objectifs, avec des parties. Le fichier `.piecemaker/objectifs.md` les décrit. Tout le reste en découle :

- **raisonnement** : chaque programme Catala et chaque acte sert un objectif ;
- **index OKF** : les parties de chaque objectif et ses points à établir disent quelles prémisses chercher dans les pièces et quelles parties elles concernent (`involves`). L'objectif décide de ce qui compte dans l'index ; l'ontologie ne dit que la forme des liens entre documents ;
- **recherche** : une question de droit se pose pour un objectif ;
- **rédaction** : un acte défend le résultat recherché de son objectif, pour sa partie, dans ses limites.

AGENTS.md annonce le fichier dans sa règle 0°. Lisez-le au début de chaque session.

## Format

Markdown sans frontmatter. Une section `## Objectif : <intitulé>` par objectif.

```markdown
# Objectifs du dossier

## Objectif : Obtenir le paiement des loyers impayés
Statut : en cours
Pour : PERSONNE_PHYSIQUE_01
Résultat recherché : condamnation du preneur au paiement de l'arriéré et résiliation du bail.
Parties :
- PERSONNE_PHYSIQUE_01 : bailleur, client
- SOCIETE_EXEMPLE_SAS : preneur, adversaire
Points à établir :
- Loyers impayés
- Commandement de payer resté sans effet
Actes : assignation-loyers
Limites : pas de délai de grâce au-delà de six mois.

## Objectif : Récupérer le local
Statut : en attente
Résultat recherché : libération des lieux avant la fin de l'année.
Parties :
- PERSONNE_PHYSIQUE_01 : bailleur, client
- SOCIETE_EXEMPLE_SAS : occupant, adversaire
```

| Champ | Obligatoire | Contenu |
| --- | --- | --- |
| `Résultat recherché` | oui | ce que le client veut obtenir, en une ou deux phrases |
| `Parties` | oui | une ligne `- <CODE> : <rôle dans cet objectif>` par partie ; le code est celui de l'index (`_parties/<CODE>.md`), jamais un nom |
| `Statut` | non | `en cours`, `en attente`, `atteint` ou `abandonné` |
| `Pour` | non | code de la partie pour qui l'objectif est poursuivi |
| `Points à établir` | non | un titre de prémisse par ligne (ou `okf:/_premises/<fiche>.md`) |
| `Actes` | non | noms des actes qui servent l'objectif, séparés par des virgules : ceux du raisonnement et du suivi |
| `Limites` et tout autre champ | non | consignes de l'avocat : seuils, ce qui est exclu, priorité |

Une même partie peut avoir un rôle différent selon l'objectif. Un tiers sans fiche de partie n'a pas de code : citez-le dans le texte d'un champ, pas sous `Parties`.

## Tenir le fichier

1. Sans fichier, demandez à l'avocat le ou les objectifs du dossier, puis écrivez-le. N'inventez pas un objectif.
2. Un objectif change, est atteint ou abandonné : mettez le fichier à jour dans le même tour.
3. Un nouvel acte : ajoutez son nom à la ligne `Actes` de l'objectif qu'il sert.
4. Une partie n'a pas encore de code : la qualification attend l'avocat (onglet Dossier, vue générale). Ne la qualifiez pas vous-même.

## Vérifier

`pm objectifs verifier` contrôle le fichier. Le Hérisson le lance après chaque écriture. `pm check` en donne l'état au point 0°.

- **erreur** : fichier absent, aucun objectif, objectif sans résultat recherché ou sans partie, statut inconnu, partie écrite par son nom ;
- **manque** : code absent de l'index, point à établir sans prémisse dans l'index, acte du raisonnement qui ne sert aucun objectif.
