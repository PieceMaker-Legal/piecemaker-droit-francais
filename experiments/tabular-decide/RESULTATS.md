# Résultats — GLiNER2.5-multi-Decide contre Luna

Essai du 2 octobre 2026, Mac M1 8 Go.

**Verdict : Decide n'est pas utilisable pour la tabular review.** Il est plus lent que Luna sur ce poste, répond au niveau du hasard dès que la question demande de comprendre la décision, et ses extraits, toujours littéraux, portent rarement sur la question.

## Protocole

- **Corpus** : recherche `"harcèlement moral" ET "obligation de sécurité"`, Cour de cassation, chambre sociale, 2019-2026, dispositif uniquement. 353 résultats, 116 retenus, les 100 premiers par ordre d'importance analysés (1 200 à 14 600 caractères, médiane 4 700).
- **Questions** : solution (4 étiquettes), cassation sur un chef relatif au harcèlement moral (oui/non), cassation sur un chef relatif à l'obligation de sécurité (oui/non), inaptitude mentionnée (oui/non). Decide ne sait que choisir parmi des réponses fermées : les colonnes en texte libre lui sont inaccessibles.
- **Luna** : prompt, vérification et relances du plugin, inchangés, 3 sessions en parallèle.
- **Decide** : CPU seul, 3 threads sur 8 cœurs (22 % de CPU mesuré), découpage en blocs de 384 mots, lots de 4. Le modèle ne renvoie aucun extrait : la citation est le paragraphe où sa confiance pour la réponse retenue est la plus forte.
- **Référence** : solution et inaptitude par expression régulière ; harcèlement et sécurité par ma lecture des dispositifs et motifs, faite avant de voir les réponses, en lecture stricte (le chef cassé doit porter sur la notion). 9 cas ambigus exclus.

## Rapidité

| | Luna | Decide |
| --- | --- | --- |
| 100 décisions | 14 min 21 s | 46 min 32 s |
| dont réponses seules | — | 18 min 22 s |
| dont recherche d'extraits | — | 28 min 09 s |
| Par décision (médiane) | 23,6 s par session, 3 en parallèle | 26,0 s, une à la fois |
| Chargement | — | 14 s (35 s à froid) |

Decide n'est donc pas plus rapide, même sans les extraits. Sans plafond de CPU il irait plus vite, mais ce n'a pas été mesuré.

Réglages essayés sur 8 décisions (réponses seules) : blocs de 384 mots par lots de 4, 10,0 s par décision ; lots de 1, 15,0 s ; lots de 8, 12,0 s ; blocs de 192 mots par lots de 16, 11,0 s. La justesse ne change pas d'un réglage à l'autre. La décision entière en une seule passe prend 41 à 57 s et 5,8 Go de mémoire : inutilisable sur 8 Go.

## Qualité et faux positifs

| Question | Luna | Decide | Réponse constante |
| --- | --- | --- | --- |
| Solution | 100 / 100 | 92 / 100 | 84 / 100 |
| Cassation sur le harcèlement moral | 88 / 94 | 49 / 94 | 49 / 94 |
| Cassation sur l'obligation de sécurité | 90 / 97 | 43 / 97 | 55 / 97 |
| Inaptitude mentionnée | 100 / 100 | 91 / 100 | 82 / 100 |

| Faux positifs (« Oui » à tort) | Luna | Decide |
| --- | --- | --- |
| Harcèlement moral | 6 / 49 | 43 / 49 |
| Obligation de sécurité | 7 / 42 | 3 / 42 |
| Inaptitude | 0 / 82 | 1 / 82 |

| Faux négatifs (« Non » à tort) | Luna | Decide |
| --- | --- | --- |
| Harcèlement moral | 0 / 45 | 2 / 45 |
| Obligation de sécurité | 0 / 55 | 51 / 55 |
| Inaptitude | 0 / 18 | 8 / 18 |

- Decide répond « Oui » 91 fois sur 100 au harcèlement et « Non » 91 fois sur 100 à la sécurité, quelle que soit la décision : il ne distingue pas les cas.
- Sa confiance ne permet pas de trier : médiane de 0,95 quand il a raison et 0,90 quand il a tort sur le harcèlement, 0,73 et 0,72 sur la sécurité.
- Les 13 « Oui » à tort de Luna sont des lectures larges, pas des inventions : la cassation porte sur un chef nommé autrement (nullité du licenciement, exécution déloyale) dont le motif repose sur la notion. En lecture large, plusieurs seraient justes.
- Sur la solution, Luna donne « Cassation partielle, Rejet » pour les 8 décisions qui rejettent un pourvoi et cassent sur l'autre, ce qui est plus exact que la référence à une seule étiquette.

## Citation exacte

| | Luna | Decide |
| --- | --- | --- |
| Extraits retrouvés mot pour mot | 387 / 387 après relance | 400 / 400 (par construction) |
| Lignes relancées pour extrait introuvable | 8 / 100 | sans objet |
| Longueur médiane | 13 à 21 mots | 32 à 76 mots (paragraphe entier) |
| Extrait contenant le terme de la question — solution | 99 / 100 | 16 / 100 |
| — harcèlement moral | 74 / 100 | 95 / 100 |
| — obligation de sécurité | 88 / 100 | 26 / 100 |

Le dernier bloc est un indicateur mécanique (présence de « casse / rejette », « harcèlement », « sécurité / prévention » dans l'extrait), pas un jugement de pertinence. Pour la solution, Decide cite le plus souvent la formule de transcription « à la suite de l'arrêt partiellement cassé » au lieu de la phrase « CASSE ET ANNULE… ».

## Limites

- Un seul corpus, une seule chambre, quatre questions.
- 84 décisions sur 100 sont des cassations partielles : la question « solution » discrimine peu.
- La référence sur le harcèlement et la sécurité repose sur une seule lecture.
- Modèle utilisé tel quel, sans entraînement sur des décisions françaises.
