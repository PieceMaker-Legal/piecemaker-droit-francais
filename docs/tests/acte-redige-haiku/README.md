# Test Haiku — l'acte rédigé dans le raisonnement

## Protocole

Test réalisé le 24 octobre 2026 sur un dossier entièrement fictif (recouvrement de deux factures, contentieux commercial). Chaque phase a été conduite par une session `haiku` neuve. Ces sessions ne disposaient que de l'instruction `instruction-testee.md`, du dossier et d'un lanceur `pm` hors ligne qui appelle le vérificateur, `runActeAction` et des textes simulés (`SOURCES.md`, identifiants fictifs). Aucun contrôle ne leur a été expliqué.

1. **Rédaction** : établir le raisonnement, rédiger les conclusions dans `acte`, boucler jusqu'à zéro erreur, imprimer `conclusions.docx`.
2. **Retouches de l'avocat** : le DOCX imprimé a été retouché (`retouches-avocat.py`), puis réenregistré par LibreOffice. Les retouches comprennent une phrase ajoutée, un passage mis en gras, un paragraphe réécrit, une section ajoutée qui cite un aveu absent des pièces et une section supprimée. Dans le même temps, le modèle a été modifié sur le même paragraphe (conflit) et sur une autre section. Demande faite à l'agent : reprendre les retouches et réimprimer.
3. **Import** : un acte rédigé ailleurs (`DOSSIER-import.md`, DOCX sans styles de titre, titres numérotés en gras, une reconnaissance de dette inventée) est repris sans être réécrit, puis le raisonnement qui le porte est établi et l'acte est imprimé.

## Résultats

| Phase | Passages du vérificateur | Résultat | Coût de la session |
| --- | ---: | --- | --- |
| 1. Rédaction | 2 | 0 erreur, 28 manques ; 9 sections, 23 paragraphes imprimés | 144 k jetons, 11 appels d'outil, 4 min |
| 2. Retouches, essai 1 | 4 | fusion correcte, mais réimpression impossible (défaut ci-dessous) | 139 k jetons, 23 appels |
| 2. Retouches, après correctif | 3 | 0 erreur, 0 manque ; réimprimé ; une nouvelle fusion ne signale plus rien | 150 k jetons, 20 appels |
| 3. Import | 7 dont 2 pour sa propre syntaxe | 0 erreur, 1 manque (date de saisine) ; 3 paragraphes modifiés sur 9 | 211 k jetons, 32 appels, 9 min |

Ce qui a fonctionné :

- Le contrôle des citations de l'acte a arrêté les deux affirmations inventées : l'aveu téléphonique ajouté par « l'avocat » et la reconnaissance de dette de l'acte importé. Les deux agents les ont retirées et ont dit à l'avocat quelle pièce manquait.
- La fusion a repris les retouches compatibles (ajout de phrase, gras, suppression de section) et isolé le seul vrai conflit. La ligne ajoutée côté modèle a été conservée.
- L'import a reconnu l'en-tête, les titres I./II., A./B./C. et le dispositif sans aucun style Word. L'agent n'a pas recopié le texte : il a ajouté le raisonnement et trois `traite`.
- Les sections qui développent un point encore à établir sont signalées : le texte ne peut pas présenter comme acquis ce que le raisonnement laisse en suspens.

Défauts trouvés et corrigés pendant le test :

- **LibreOffice retire les contrôles de contenu de bloc.** Il garde la base de fusion, si bien que tout l'acte aurait été dupliqué à la fusion. Corrigé par un second ancrage par signet `pma_sN`. Une fusion sans aucun repère est désormais refusée.
- **Une retouche écartée revenait à chaque fusion et bloquait la réimpression**, parce que la base enregistrée dans le DOCX n'avançait pas (essai 1 de la phase 2). Après une fusion, la base avance désormais jusqu'au texte lu ; seule la propriété cachée du DOCX change.
- `git merge-file` considère comme un conflit deux paragraphes voisins modifiés chacun d'un côté. Ces conflits sont désormais affinés paragraphe par paragraphe (`--diff3`).
- Une lettre de titre « C. » était lue comme le chiffre romain 100.

## Limites constatées

- Une section sans `traite` n'est contrôlée que sur ses citations. En phase 1, la section « Sur la prescription » affirmait une prescription non acquise sans être signalée.
- Le vérificateur ne lit pas le sens de la prose. En phase 2, l'agent a « prouvé » la validité des clauses par la citation « Fait à Lyon le 10 janvier 2024 ». Ce défaut appartient au moteur et non à l'acte, mais l'acte en hérite.
- L'agent a corrigé de lui-même une erreur de calcul de date de sa propre rédaction (« plus de huit semaines » pour 55 jours). Aucun contrôle ne vérifie les nombres écrits dans la prose.
- Mise en forme autre que gras et italique, commentaires Word, tableaux et notes ne sont pas repris. La fusion refuse les trois derniers plutôt que de les perdre.

## Fichiers

- `DOSSIER.md`, `DOSSIER-import.md`, `SOURCES.md`, `pieces/` : corpus fictif.
- `instruction-testee.md` : instruction exacte donnée aux agents.
- `phase1-raisonnement.js`, `phase2-essai-avant-correctif.js`, `phase2-raisonnement-apres-fusion.js`, `phase3-raisonnement-importe.js` : objets littéraux produits, à lire avec le parseur du moteur.
- `retouches-avocat.py` : retouches appliquées au DOCX et au modèle pour la phase 2.

Les DOCX, le lanceur hors ligne et les transcriptions restent hors du dépôt.
