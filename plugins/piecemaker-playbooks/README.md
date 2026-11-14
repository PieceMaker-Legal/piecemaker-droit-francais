# Playbooks

Plugin PieceMaker de guides de négociation et de revue contractuelle.
Les règles et les revues appartiennent au dossier sélectionné.

## Parcours

1. Ouvrir un dossier dans PieceMaker, puis le plugin Playbooks.
2. Créer un guide ou sélectionner un document du dossier et choisir « Importer ce document comme guide ».
3. Vérifier les règles, leurs positions et leurs références au guide.
4. Cocher la validation et enregistrer le guide.
5. Sélectionner le contrat, le fournisseur, le modèle et la politique de revue.
6. Lancer la revue, puis examiner les résultats et les extraits retrouvés.
7. Pour un contrat Word, proposer les révisions dans la copie Eigenpal.
8. Accepter ou refuser les révisions dans Eigenpal, puis enregistrer la copie.

Les règles contiennent un concept, une position souhaitée, des replis, des refus, des conditions et des consignes.
Une modification des règles retire leur validation jusqu'à une nouvelle confirmation.
Les règles omises par le modèle et les extraits non retrouvés restent signalés.
Un extrait retrouvé ne prouve pas que l'analyse juridique du modèle est correcte.

## Comptes et anonymisation

Les sessions utilisent Claude, Codex ou Mistral par le transport éphémère de l'analyse tabulaire.
Les comptes et modèles viennent de PieceMaker ; aucune clé API Mike n'est nécessaire.
Le transport est exposé par une façade publique du plugin tabulaire et inclus dans le bundle Playbooks.
Le plugin tabulaire n'a donc pas besoin d'être activé.

Le dossier doit être enregistré et son anonymisation terminée, sans levée de protection.
Le serveur vérifie cette condition avant lancement ou reprise.
Une session refuse de démarrer si le proxy d'anonymisation ne répond pas.
Les guides et contrats sont transmis comme données, dans une session sans outils sous Claude.
Codex utilise le mode éphémère en lecture seule du transport existant.

## Word et Eigenpal

Le plugin charge la version Eigenpal déjà installée dans PieceMaker.
Il utilise `DocxEditor.findInDocument`, `proposeChange` et `save`.
Les styles viennent du même paquet installé ; aucune copie de l'éditeur n'est vendorisée.

Chaque revue Word conserve le fichier source et crée `document-revu.docx`.
Les propositions modifient uniquement cette copie, jamais l'original.
Un passage ambigu, non retrouvé ou déjà révisé est refusé.
Les propositions sans extrait ou ancre vérifiés ne sont pas applicables automatiquement.

L'enregistrement compare l'empreinte attendue à l'empreinte actuelle du document.
Un reçu local permet de rapprocher une sauvegarde interrompue entre l'écriture Word et l'enregistrement du résultat.
Le même résultat ne peut pas être proposé deux fois après rapprochement.
Les modifications manuelles dans Eigenpal se conservent avec « Enregistrer les révisions ».

## Conservation et reprise

- `Playbooks/<id>.json` : règles, validation et sources du guide.
- `Revues contractuelles/<id>/run.json` : règles figées, texte examiné, résultats et état du traitement.
- `Revues contractuelles/<id>/source.docx` : source Word figée.
- `Revues contractuelles/<id>/document-revu.docx` : copie examinée dans Eigenpal.

Ces fichiers restent dans le dossier client et peuvent être versionnés par son historique Git.
Ils ne sont pas écrits dans le répertoire du plugin, remplacé lors des mises à jour.
Un arrêt conserve les données. Un traitement sans processus actif apparaît comme interrompu.
La reprise est explicite et utilise les mêmes règles, texte, fournisseur et modèle.
La reprise recommence l'appel IA ; elle peut consommer de nouveau du quota.

## Formats et limites

- Word `.docx`, Markdown `.md` et texte `.txt`.
- PDF déjà converti par PieceMaker : le plugin lit le fichier `.md` de même nom à côté du PDF.
- Les paragraphes et cellules de tableaux Word du guide portent des références stables pendant l'import.
- Les suppressions suivies sont exclues du texte analysé ; les insertions sont incluses.
- Maximum 25 Mo par fichier, 180 000 caractères par contrat et 150 000 caractères structurés par guide.
- Maximum 200 règles et deux traitements IA simultanés par processus Playbooks.

Cette version ne fournit pas de partage entre utilisateurs, de lecture à la demande de documents supplémentaires ou d'export automatique vers OKF.
Elle n'ajoute pas de complément Microsoft Word : Eigenpal fonctionne dans PieceMaker.

## Origine et vérification

Le mécanisme s'inspire des playbooks de [Mike](https://github.com/open-legal-products/mike), commit `f6f45fe6eec17ec033cf29207cfa7ef573d612b3`.
Le portage remplace son stockage Supabase, ses appels API et ses pages Next.js par les mécanismes PieceMaker.
Les références principales sont `playbooks.schemas.ts`, `playbooks.word.ts`, `playbooks.operations.ts` et `documents.reviewPublication.ts` de Mike.

Les tests du plugin couvrent les règles importées, les revues, les interruptions, les autorisations et la publication Word.
Le test navigateur utilise le véritable Eigenpal avec un modèle simulé et un document fictif.
Il contrôle les balises de révision du fichier enregistré et sa réouverture, sans capture d'écran ni appel IA payant.
