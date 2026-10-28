# Test Luna — instruction sur les exceptions et contradictions

## Protocole et résultat

Test réalisé le 21 octobre 2026 avec une session neuve de `gpt-6-luna`, effort `high`, à partir du dernier objet fautif et de six pièces entièrement fictives. L’agent reçoit l’instruction du commit `6f4f5410`, le dossier, l’objet et les moyens d’appeler le vérificateur et de rechercher les sources. Aucune correction ciblée ni solution juridique ne lui est donnée pendant la reprise. Le moteur et son instruction ne sont pas modifiés.

Après sept passages : **0 erreur, 3 manques**, reproduits par un rejeu indépendant de l’objet final. L’objectif de paiement reste à établir.

## Changements observés

- Retrait des `sauf` utilisés pour faire prévaloir une interprétation sur une autre.
- Retrait du seuil artificiel de 1,2 % du capital comme preuve suffisante d’absence d’effet dissuasif.
- Scénarios favorables et défavorables produisant des résultats opposés sous leurs hypothèses.

Le passage de un à trois manques rétablit des inconnues auparavant masquées : lecture excluant le droit contractuel du vote ex post, non-participation à la délibération du conseil, absence d’atteinte majeure à l’équilibre financier.

## Limite importante

La condition « le juge retient… » reste sans preuve ni sous-raisonnement. Le moteur la signale explicitement comme manque nº 1 : les citations placées dans `selon` ne suffisent pas à établir ce fait. L’agent n’a pas développé les deux lectures en une contradiction commune reconnue par le moteur.

Une citation introuvable constitue une erreur ; une condition décisive non établie constitue un manque. Le moteur ne vérifie pas que le sens d’une citation justifie l’interprétation proposée. Ce test constate donc une correction partielle de l’usage du format, sans valider le fond juridique ni conclure au paiement.

## Fichiers et vérification

- `DOSSIER.md` et `pieces/` : mission et six pièces fictives, préservées pendant le test.
- `instruction-testee.md` : instruction exacte utilisée.
- `objet-avant.js` et `objet-apres.js` : objets littéraux avant et après la reprise ; à lire avec le parseur du moteur, sans les exécuter.
- `retour-verificateur.txt` : retour du rejeu indépendant. Sa formule standard « a été réécrit » décrit le vérificateur ; le rejeu parent n’a pas écrasé l’objet de l’agent.
- `manifest.json` : empreintes SHA-256 des fichiers archivés.

Les caches de recherche, le runner local et les sept passages restent hors du dépôt. Cette archive permet de revoir le résultat et le corpus ; elle ne constitue pas un test automatisé autonome ni un rejeu hors ligne complet. Certaines sources judiciaires ont été vérifiées dans une reproduction accessible, pas dans un texte officiel récupéré par MCP ; cette limite interdit de présenter le résultat comme une validation des citations pour un acte.
