# tabular_review

```
pm tabular_review lister
pm tabular_review ouvrir --fichier "Tabular Review/analyse.json"
pm tabular_review ouvrir --projet ID
pm tabular_review documents
pm tabular_review modeles [--modele ID]
pm tabular_review enregistrer_modele --nom TEXT --questions JSON [--modele ID]
pm tabular_review preparer --mode analyse|recherche --nom TEXT [--projet ID] [--modele ID] [--description TEXT] [--questions JSON] [--documents a,b] [--recherche JSON]
pm tabular_review lancer --projet ID [--ia claude|codex|mistral] [--modele-ia TEXT]
pm tabular_review lire --fichier analyse.json
pm tabular_review colonnes --fichier analyse.json --questions JSON
pm tabular_review relancer --fichier analyse.json
```

`--questions` JSON : `[{nom, consigne, format, etiquettes}]`. `format` : `text` `list` `date` `amount` `yes_no` `tags`.

`colonnes` : sans `colonne`, ajoute une question ; avec `colonne` (numéro donné par `lire`), modifie la question ou la supprime avec `supprimer: true`. Les cellules déjà remplies gardent leur réponse.

`relancer` analyse les nouveaux documents Markdown : lancez `pm conversion` avant pour les pièces non converties.

`--recherche` JSON : `query`, `sources` (`cassation` `appel` `conseil_etat` `caa` `premiere_instance`), `matieres` (cassation : `CIVIL` `COMMERCIAL` `PENAL` `SOCIAL`), `publicationBulletin` (`TOUS` `PUBLIE` `INEDIT`), `sieges`, `publicationConseilEtat` (`TOUS` `PUBLIE` `NON_PUBLIE`), `villesCaa`, `publicationCaa` (`TOUS` `PUBLIE` `NON_PUBLIE`), `typesPremiereInstance` (`TRIBUNAL_JUDICIAIRE` `TRIBUNAL_GRANDE_INSTANCE` `TRIBUNAL_INSTANCE` `TRIBUNAL_COMMERCE` `CONSEIL_PRUDHOMMES` `TRIBUNAL_CORRECTIONNEL` `TRIBUNAL_SECURITE_SOCIALE` `TRIBUNAL_BAUX_RURAUX` `JURIDICTION_PROXIMITE` `OUTRE_MER` `TRIBUNAL_CONFLITS`), `dateDebut`, `dateFin`, `dispositifOnly`.
