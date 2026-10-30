# Vérification du soutien des affirmations

Le test du raisonnement examine la correspondance entre chaque affirmation et les citations attachées. Les contrôles mécaniques précèdent cet examen.

| Réponse obligatoire | Conséquence |
| --- | --- |
| `validé` | Le lien reste utilisable, sous réserve des autres contrôles. |
| `non validé` | Erreur localisée ; le lien ne suffit plus à établir la proposition. |
| `indéterminé` | Manque localisé ; le lien reste à établir. |

Chaque réponse contient `emplacement`, `reponse`, `score` et `explication`. Le score de confiance, entier de 1 à 5, reste informatif.

Une sortie incomplète, invalide ou indisponible produit des manques techniques. Elle ne produit jamais une validation implicite.

## Fournisseur et modèle

Le serveur lit le fournisseur choisi dans les préférences du compte authentifié. Une requête peut préciser `provider`.

| Fournisseur choisi | Modèle du vérificateur |
| --- | --- |
| Mistral | `mistral-small-latest` |
| Claude | `haiku` |
| Codex | `gpt-6-luna`, effort `high` |

Sans préférence, Claude reste le défaut de l’application. Aucun changement silencieux de fournisseur ne compense une indisponibilité.

La commande locale reprend les préférences du seul compte actif. Plusieurs comptes actifs imposent une vérification depuis une session authentifiée.

Les appels passent dans le contexte d’anonymisation du dossier. Mistral utilise les identifiants du compte concerné. Aucune recherche externe n’est demandée au modèle.

## Déclenchement et cache

Le bouton de test et la commande `pm raisonnement verifier` déclenchent le contrôle. Une erreur mécanique bloque l’appel sémantique.

Un appel groupe les liens lisibles, leurs sources et le raisonnement. Le cache en mémoire distingue compte, fournisseur, modèle, consigne et données.

Un contrôle identique réutilise son résultat. Une panne ou une sortie invalide n’est pas conservée comme succès.

Les simulations et réévaluations hors ligne n’appellent aucun modèle. Sans résultat en cache, elles conservent des manques techniques.

Une modification du raisonnement pendant l’appel interdit d’écraser la version retouchée. Les annotations du juge ne sont pas écrites dans le YAML déclaratif.

## Portée

`validé` qualifie le lien citation–affirmation. Ce verdict ne certifie ni la force probante, ni l’applicabilité, ni la conclusion juridique entière.

Les réponses brutes, prompts et données clients des essais restent hors dépôt. Les tests versionnés utilisent des faits et sources fictifs.
