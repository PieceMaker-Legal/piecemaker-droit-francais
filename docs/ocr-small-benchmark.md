# Small : configuration mesurée sur trois documents

Essais du 1er novembre 2026, sur MacBook Air M1 avec 8 Gio de RAM.
Le profil retenu privilégie le Markdown final : détection limitée à 3 200 pixels, lot de reconnaissance d’une ligne et dilatation activée.
Les quatorze configurations utilisent les mêmes images à 300 DPI et les mêmes références figées.
Onze configurations terminent les treize pages. Les trois autres rencontrent la protection mémoire.

Le profil retenu donne 80 écarts de caractères dans le Markdown du texte, contre 132 avec le profil initial.
La validation avec le worker Python réel de PieceMaker termine les treize pages avec un pic observé de **2,54 Go**.
Le profil initial s’arrête sur les deux tableaux après dépassement du plafond mémoire.

## Configuration intégrée

| Paramètre | Valeur |
| --- | --- |
| Modèles | PP-OCRv6 Small, détection et reconnaissance ONNX, révisions existantes inchangées |
| Rendu PDF | 300 DPI |
| Détecteur | `limit_side_len=3200`, `limit_type=max` |
| Seuils de détection | `thresh=0.3`, `box_thresh=0.6` |
| Extension des boîtes | `unclip_ratio=1.5` |
| Dilatation du masque | `use_dilation=True` |
| Calcul du score des boîtes | `score_mode=fast` |
| Reconnaissance | `batch_size=1`, `score_thresh=0.0` |
| Moteur et threads | ONNX Runtime CPU, deux threads internes, un entre opérations |
| Options mémoire ONNX | `enable_cpu_mem_arena=False`, `enable_mem_pattern=False` |
| Orientation et redressement | Les trois modules restent désactivés |
| Exécution | Un processus neuf par page, successivement |

Le rendu PDF reste à 300 DPI. La limite de 3 200 pixels concerne l’image de travail du détecteur.
La dilatation épaissit le masque de détection avant le calcul des boîtes.
Le code applique cette option au post-traitement de PaddleX 3.7.2, dont la version reste verrouillée.
L’installation, les téléchargements, l’environnement Python commun et le compilateur de coordonnées restent inchangés.

La [documentation officielle de détection](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/text_detection.md) propose notamment le seuil de boîte 0,5, le calcul `slow` et la dilatation.
Ces recommandations ont servi à construire les variantes. Le profil dit « précision » ne gagne pas systématiquement sur ces documents.

## Références et protocole

| Corpus | Pages contrôlées | Référence |
| --- | --- | --- |
| Texte | 8 pages | Transcription manuelle figée, 18 436 caractères normalisés |
| Tableau A | Pages PDF 3 à 5 | 699 cellules numériques et 73 tirets, transcrits manuellement |
| Tableau B | Pages PDF 1 et 2 | 961 cellules numériques et 559 tirets, issus de la couche texte du PDF |

Les empreintes des PDF et des références sont vérifiées avant les mesures.
Les valeurs numériques gardent leur ponctuation. Un second score vérifie les chiffres seuls.
Les cellules OCR brutes sont attribuées par leurs coordonnées. Les tableaux Markdown sont évalués séparément.
Les références, images, JSON, Markdown et erreurs détaillées restent hors du dépôt.
Les premières tentatives conservant un moteur entre les pages ont été écartées de cette comparaison.

PaddleOCR 3.7.0, PaddleX 3.7.2, ONNX Runtime 1.23.2, NumPy 2.3.5 et Python 3.12 sont utilisés.
Les modèles sont les deux snapshots officiels déjà fixés par le manifeste de PieceMaker.

## Qualité OCR brute

Les variantes numériques indiquent la taille maximale du détecteur et le lot de reconnaissance.
Tous les profils sauf « Initial » désactivent les deux options mémoire ONNX.
« Précision » utilise `box_thresh=0.5` et `score_mode=slow`, avec un lot d’une ligne.
« Boîtes 1,2 » modifie seulement `unclip_ratio`. « Rappel » utilise `thresh=0.2` et `box_thresh=0.5`.
« Dilatation » active seulement la dilatation en plus du profil 3200 / lot 1.
Les trois profils initiaux gardent `limit_side_len=64`, `limit_type=min`, avec la limite interne de 4 000 pixels.

| Profil | Écarts texte / 18 436 | Nombres exacts A / 699 | Nombres exacts B / 961 | Tirets validés / 632 |
| --- | ---: | ---: | ---: | ---: |
| Initial | 123 | Arrêt RAM | Arrêt RAM | Incomplet |
| Initial, mémoire optimisée | 123 | 670 | Arrêt RAM | Incomplet |
| Initial, mémoire optimisée, lot 1 | 90 | 670 | Arrêt RAM | Incomplet |
| 1600 / lot 6 | 95 | 645 | 884 | 0 |
| 2400 / lot 6 | 92 | 659 | 884 | 1 |
| 3200 / lot 6 | 142 | 674 | 885 | 0 |
| 1600 / lot 1 | 71 | 645 | 884 | 0 |
| 3200 / lot 1 | 95 | 674 | 885 | 0 |
| 1600 / précision | 72 | 646 | 884 | 0 |
| 2400 / précision | 80 | 660 | 884 | 2 |
| 3200 / précision | 106 | 673 | 885 | 0 |
| 3200 / boîtes 1,2 | 212 | 668 | 868 | 0 |
| **3200 / dilatation** | 71 | 675 | 879 | 0 |
| 3200 / rappel | 87 | 675 | 885 | 0 |

La dilatation ne domine pas tous les scores bruts. Le profil « Rappel » lit six nombres supplémentaires dans le tableau B.
La sélection porte sur la sortie Markdown : la dilatation y conserve davantage de valeurs exactes et produit moins d’écarts de texte.

## Comparaison des Markdown finaux

La dilatation donne le moins d’écarts textuels et le plus de valeurs numériques exactes présentes parmi les onze profils complets.
Les deux tableaux totalisent 1 660 cellules numériques contrôlées. Présence et placement restent deux mesures distinctes.

| Profil | Écarts texte / 18 436 | Nombres présents / 1 660 | Nombres bien placés / 1 660 |
| --- | ---: | ---: | ---: |
| 1600 / lot 1 | 100 | 1520 | 437 |
| 2400 / précision | 173 | 1534 | 431 |
| 3200 / lot 1 | 124 | 1527 | 432 |
| 3200 / rappel | 88 | 1528 | 429 |
| **3200 / dilatation** | 80 | 1545 | 430 |

## RAM consommée

Les poids téléchargés occupent environ 31 Mo. L’exécution utilise beaucoup plus de mémoire pour les images et le calcul.
Les valeurs suivantes sont en **Go décimaux**, soit un milliard d’octets.
La colonne RAM mesure l’empreinte du worker et de ses enfants vue par macOS, compression comprise (`phys_footprint`).
Le maximum est observé toutes les 0,5 seconde. Les autres applications sont exclues de cette mesure.
Le RSS indique le maximum de mémoire résidente du worker, mesuré par le système. Les maxima RAM et RSS peuvent survenir à des moments différents.

| Profil | RAM texte, Go | RAM tableau A, Go | RAM tableau B, Go | RSS maximal, Go |
| --- | ---: | ---: | ---: | ---: |
| Initial | 2,74 | 3,05 · arrêt | 3,01 · arrêt | Incomplet |
| Initial, mémoire optimisée | 2,45 | 2,95 | 3,08 · arrêt | Incomplet |
| Initial, mémoire optimisée, lot 1 | 2,48 | 2,97 | 3,09 · arrêt | Incomplet |
| 1600 / lot 6 | 1,11 | 1,08 | 1,14 | 0,82 |
| 2400 / lot 6 | 1,48 | 1,48 | 1,53 | 1,08 |
| 3200 / lot 6 | 2,24 | 2,24 | 2,27 | 1,55 |
| 1600 / lot 1 | 0,91 | 0,91 | 0,97 | 0,84 |
| 3200 / lot 1 | 2,09 | 2,17 | 2,39 | 1,48 |
| 1600 / précision | 0,93 | 0,91 | 0,98 | 0,93 |
| 2400 / précision | 1,48 | 1,51 | 1,62 | 1,00 |
| 3200 / précision | 2,09 | 2,15 | 2,40 | 1,34 |
| 3200 / boîtes 1,2 | 2,15 | 2,09 | 2,34 | 1,36 |
| **3200 / dilatation** | 2,12 | 2,10 | 2,38 | 1,55 |
| 3200 / rappel | 2,15 | 2,13 | 2,46 | 1,61 |

Pour une exécution arrêtée, la valeur indique le maximum observé avant l’arrêt.

Le plafond reste fixé à 35 % de la RAM totale : 3,01 Go sur cette machine de 8 Gio.
Le superviseur arrête aussi le worker sous 10 % de mémoire disponible, soit environ 0,86 Go sur cette machine.
Le Markdown antérieur reste conservé si une page échoue. Les protections et leurs variables de réglage restent inchangées.

## Validation du code intégré

Le contrôle final appelle `ocr_small.parse_page` sur les PDF sources, puis le compilateur Markdown réel.
La comparaison des profils chargeait les PNG prérendus. La validation refait le rendu depuis les PDF.
Chaque page démarre dans un processus neuf. Le contrôle conserve les limites mémoire du produit.
Les textes, boîtes et scores des treize pages correspondent exactement à la campagne du profil retenu.
Le contrôle retrouve chacun des 2 531 textes de ligne dans les Markdown produits.
Les neuf tests Python et treize tests de régression Node réussissent, sans test ignoré.

| Corpus | Écarts texte brut / Markdown | Nombres exacts JSON | Nombres exacts présents en tableau Markdown | Nombres placés dans la grille Markdown | RAM observée, Go | RSS, Go | Temps total, s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Texte | 71 / 80 | — | — | — | 2,24 | 1,33 | 118,8 |
| Tableau A | — | 675 / 699 | 675 | 281 | 2,26 | 1,32 | 70,1 |
| Tableau B | — | 879 / 961 | 870 | 149 | 2,54 | 1,65 | 73,6 |

Le temps total inclut les démarrages Python, le rendu PDF, l’OCR et la compilation Markdown des pages retenues.
Il exclut les téléchargements et le calcul des scores. Les applications ouvertes rendent ces durées indicatives.

## Limites et réglages écartés

Les tableaux complexes restent imparfaits. Les textes reconnus sont conservés, mais plusieurs valeurs peuvent partager une cellule Markdown.
Le score de placement utilise un décalage global de lignes et de colonnes. Les cellules fusionnées et les lignes ajoutées affectent ce score.
Les nombres présents ne prouvent donc pas que la structure du tableau est fidèle.
Les tirets restent mal reconnus. Le comparateur historique produit aussi des faux négatifs sur certains renvois accolés.
Un score nul de tirets ne prouve pas que chaque tiret est absent.

Le tri des boîtes par leur bord supérieur a été rejoué séparément. Il dégrade le texte du profil retenu de 80 à 102 écarts.
Le compilateur de coordonnées conserve donc son fonctionnement actuel.
Un rejeu de seuils de confiance de 0 à 0,75 sur le profil 3200 / lot 1 réduit certains parasites.
Ce contrôle ne couvre pas tous les en-têtes des tableaux. Le seuil zéro reste conservé pour éviter leur suppression automatique.
Ces rejeux JSON ne constituent pas de nouvelles mesures de RAM.

La transcription manuelle du texte a été préparée après consultation des sorties et n’a pas reçu de relecture indépendante.
La référence du tableau B provient du PDF, avec douze jetons rejetés lors de sa constitution. Elle ne couvre pas tous les textes.
Les réglages sont choisis sur ces trois documents, sans corpus de validation indépendant.
Le profil retenu représente le meilleur compromis observé pour ces essais. Windows et Mac Intel n’ont pas été testés sur ces corpus.

## Reproduction

Le script `tune-small.py` et les comparateurs sont conservés dans le worktree local `OCR-benchmark`.
Utiliser son dossier `scripts/piecemaker/ocr-benchmark`, les trois corpus externes et un répertoire de travail neuf.
Le Python du test doit disposer des versions indiquées plus haut et des bibliothèques Markdown du convertisseur.
Le cache Hugging Face doit contenir les snapshots vérifiés du manifeste PieceMaker.

```sh
python tune-small.py --production /chemin/piecemaker/server/piecemaker/vendor/websocket-server/scripts \
  --work /chemin/externe/nouvel-essai \
  --corpora /chemin/externe/texte /chemin/externe/tableau-a /chemin/externe/tableau-b \
  --only det3200-b1-dilation
```

Remplacer le profil par `integrated` vérifie le worker actuellement présent dans le clone PieceMaker.
Les résultats privés sont conservés dans `/private/tmp/piecemaker-small-tuning-20261101-pages` et `/private/tmp/piecemaker-small-integrated-20261101`.
