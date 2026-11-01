# Configuration du style Word

Lis ce fichier uniquement si `style-docx.py etat` indique « À CONFIGURER », ou si l'utilisateur demande de modifier le style.

## Procédure

1. Lis [style-docx-defaut.json](style-docx-defaut.json). Ce profil vient du modèle d'assignation du cabinet.
2. Pose les questions ci-dessous, une à la fois. Donne la valeur par défaut dans chaque question.
3. Écris les réponses dans un fichier `profil.json`, de même structure que le profil par défaut. Pour une modification, pars du profil existant.
4. Demande à l'utilisateur de fermer LibreOffice. LibreOffice écrase sa configuration à la fermeture.
5. Lance `python3 <dossier du skill>/scripts/style-docx.py appliquer --profil profil.json`.
6. Le script ouvre le document test dans LibreOffice. Demande à l'utilisateur de le contrôler.
7. Si l'utilisateur demande une correction, modifie le profil et reprends à l'étape 4.

## Questions

### Police et corps de texte

1. Quelle police ? (`police`)
2. Quelle taille de texte ? (`corps.taille`)
3. Quel alignement : justifié, gauche, centré ou droite ? (`corps.alignement`)
4. Quel interligne : 1, 1,15, 1,5 ou 2 ? (`corps.interligne`)
5. Quel espace avant et après un paragraphe, en points ? (`corps.avant`, `corps.apres`)
6. Quel retrait à gauche et de première ligne, en cm ? (`corps.retrait_gauche_cm`, `corps.premiere_ligne_cm`)

### Page

7. Quelles marges haut, droite, bas et gauche, en cm ? (`page.marges_cm`) Le format reste A4.
8. Quelle pagination : « page / total », « page » ou aucune ? (`page.pagination`)

### Titre et sous-titre du document

9. Pour le titre principal : quelle taille, gras, italique, souligné, majuscules, alignement et espaces ? (`titre`)
10. Le titre principal a-t-il un encadré et une couleur de fond ? (`titre.encadre`, `titre.fond`)
11. Pour le sous-titre : quelle taille, gras, italique, souligné, majuscules, alignement et espaces ? (`sous_titre`)

### Numérotation des titres

12. Quel système de numérotation ? (`niveaux[n].format`, `niveaux[n].modele`)

| Système | Exemple au niveau 4 | Formats des niveaux 1 à 4 | Modèle du niveau 4 |
| --- | --- | --- | --- |
| Romain puis décimal | I.1.1.1. | `romain_maj`, `decimal`, `decimal`, `decimal` | `%1.%2.%3.%4.` |
| Romain, lettre, décimal | I.A.1.a. | `romain_maj`, `lettre_maj`, `decimal`, `lettre_min` | `%1.%2.%3.%4.` |
| Décimal | 1.1.1.1. | `decimal` à tous les niveaux | `%1.%2.%3.%4.` |
| Sans numérotation | Aucun | `aucun` à tous les niveaux | Sans objet |

13. La numérotation est-elle cumulée (I.A.1.) ou limitée au niveau (1.) ? Un modèle limité au niveau 3 s'écrit `%3.`. Il doit contenir le numéro de son niveau.
14. Quel signe suit le numéro : point, parenthèse ou tiret ? (`modele`)

### Titres, niveaux 1 à 9

Pose ces questions pour chaque niveau, dans `niveaux[0]` à `niveaux[8]`. Pour aller plus vite, propose d'abord de regrouper les niveaux identiques.

15. Quelle taille ? (`taille`)
16. Gras, italique, souligné, majuscules ? (`gras`, `italique`, `souligne`, `majuscules`)
17. Quelle couleur ? (`couleur`, valeur hexadécimale)
18. Quel alignement ? (`alignement`)
19. Quel espace avant et après, en points ? (`avant`, `apres`)
20. Quel retrait à gauche et quel retrait du numéro, en cm ? (`retrait_gauche_cm`, `suspendu_cm`)

### Citations et notes

21. Pour les citations : quelle taille, italique, alignement, espaces et retrait ? (`citation`)
22. Quelle taille pour les notes de bas de page ? (`note.taille`)

### Application dans LibreOffice

23. Le style s'applique-t-il aussi aux documents existants à l'ouverture, ou seulement aux nouveaux documents ? (`ouverture.appliquer_aux_documents_existants`)

Avant la réponse à la question 23, donne cet avertissement : à l'ouverture, le style modifie la mise en page des documents reçus, donc leur pagination. La mise en forme directe du document reste en place. Le fichier ne change que si l'utilisateur l'enregistre.

## Commandes

| Commande | Effet |
| --- | --- |
| `etat` | Indique si le style est configuré. |
| `appliquer --profil F` | Valide le profil, l'enregistre, configure LibreOffice et ouvre le document test. |
| `creer SORTIE.docx [--markdown-file F] [--depuis MODELE]` | Crée un `.docx` avec le style. |
| `retirer` | Retire le style de LibreOffice et repasse à « à configurer ». |
