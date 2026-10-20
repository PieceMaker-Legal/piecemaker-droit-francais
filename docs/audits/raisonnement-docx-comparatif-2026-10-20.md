# Comparatif du raisonnement directement depuis un DOCX

## Choix retenu

Le prototype utilise les contrôles de contenu Word comme ancres, une propriété native du DOCX pour le modèle, un lecteur OOXML limité et le moteur `verifyReasoning` déjà présent. Une commande reçoit le DOCX et rejoue le modèle embarqué avec les valeurs réellement lues dans ses champs, sans fichier de raisonnement compagnon et sans appel LLM.

Les opérations automatiques sont à égalité à zéro token de modèle : c’est la fiabilité, la portabilité observée et la maintenance qui départagent les solutions. Le choix ne signifie pas qu’un calcul déterministe démontre la validité juridique du texte. Le modèle et le marquage initiaux doivent être préparés ; ce travail initial n’est pas inclus dans la mesure.

## Comparaison exécutée

Même scénario fictif, même logique de calcul, mêmes champs imbriqués et mêmes retouches. Versions réellement utilisées : EigenPal core 1.9.0, Docxtemplater 3.71.1, PizZip 3.3.0, JSZip 3.10.1, xmldom 0.9.12. docx-cli 0.24.0 installé et 0.27.0 téléchargé dans un dossier isolé, SHA-256 vérifié ; le binaire installé n’a pas été remplacé.

| Chemin essayé | Résultat observé | Décision |
| --- | --- | --- |
| Lecture OOXML des ancres et moteur existant | Lit les champs imbriqués, exécute les hypothèses, relit les valeurs modifiées et refuse les états périmés | Retenu pour le test |
| API EigenPal 1.9 | Recherche des contrôles, modification par `setContentControlContent` et sauvegarde du modèle réussies | Conservée pour l’édition ; aucune nécessité de la charger pour lire les seules ancres |
| docx-cli 0.24 et 0.27 | Dans le fichier testé, la lecture omet les textes des contrôles inline imbriqués ; la recherche de `10 %` ne donne aucun résultat et son remplacement échoue | Non retenu comme lecteur des données liées ; ce constat ne condamne pas ses autres usages |
| Docxtemplater | Génération initiale réussie ; régénérer depuis le template initial efface la retouche libre du document de travail | Utile pour produire un premier document, insuffisant seul pour maintenir le lien après retouches |
| Modèle dans une partie `customXml` | Conservé par EigenPal, perdu dans le conditionnement essayé lors du réenregistrement LibreOffice | Conditionnement écarté pour ce prototype |
| Modèle dans une propriété native `PieceMakerReasoning` | Conservé par EigenPal et LibreOffice ; les valeurs et les deux hypothèses restent testables après sauvegarde | Conditionnement retenu |

Le premier échec attribué à EigenPal venait d’un appel erroné à une API de texte d’une autre version. Après remplacement par l’API appropriée de la version 1.9, l’essai réussit. Cet échec n’est donc pas retenu contre la bibliothèque.

La fonction générique `getBodyText` d’EigenPal ne restitue pas les clauses SDT de cette fixture. Le calcul final des contextes utilise une extraction OOXML complète, y compris les champs ; il n’utilise pas cette projection incomplète.

Cicero, docassemble et docx4j ont fourni des idées lors de la recherche préalable, mais leurs moteurs complets n’ont pas été installés ni chronométrés dans ce comparatif. Aucun classement de leurs performances ou de leur coût réel n’est prétendu. Le prototype évite un second moteur de règles et un service supplémentaire.

## Mesure des tokens

Le benchmark prépare dix contextes sur une fixture de trois clauses liées et quarante paragraphes fictifs supplémentaires. Le comptage utilise `tiktoken`, encodage `o200k_base`. Aucun contexte n’a été envoyé à un modèle : il s’agit de tailles mesurées de contextes préparés, pas d’une facture, ni d’une calibration du tokenizer de Luna.

| Modification | Contexte complet préparé | Contexte ciblé préparé | Traitement |
| --- | ---: | ---: | --- |
| Inchangé | 1975 | 0 | Rejeu local |
| Plafond, durée, prix ou taux | 1975 par cas | 0 | Valeurs relues et calcul local |
| Mise en forme seule | 1975 | 0 | Rejeu local |
| Négation de la clause de pénalité | 1976 | 323 | Raisonnement à revoir ; seul le passage concerné et le modèle sont préparés |
| Ajout d’une clause non liée | 1988 | 2010 | Revue élargie conservatrice ; aucun gain forcé |
| Ancre supprimée ou valeur ambiguë | Environ 1975 | 0 | Refus explicite ; aucune conclusion ancienne présentée comme actuelle |

Sur la retouche de clause localisée, le contexte préparé diminue d’environ 84 %. Ce résultat dépend de la taille artificielle de la fixture. Il ne permet pas d’annoncer une économie universelle. Une suppression d’ancre ou une valeur ambiguë n’est pas une analyse achevée à moindre coût : c’est un blocage à résoudre.

Les dix contextes complets totalisent 19 763 tokens ; les contextes ciblés préparés en totalisent 2 333. Les recalculs déterministes consomment effectivement zéro appel et zéro token LLM. L’interprétation initiale, une révision de fond par un agent et une vérification juridique complète ne sont pas gratuites et n’ont pas été facturées dans cet essai.

## Fonctionnement du prototype

- Le modèle déclaratif existant est enregistré comme JSON dans la propriété native `PieceMakerReasoning`, dans `docProps/custom.xml`. Son code reste un littéral lu par `parseLiteral`, jamais exécuté comme du JavaScript.
- Les champs ont des tags permanents et des types explicites : nombre au format français, pourcentage ou date ISO. Une valeur ambiguë est refusée. Les liaisons ne peuvent pas remplacer une valeur calculée ou fixée par un texte de droit.
- Les empreintes de texte conservent les mots et la ponctuation. Les seuls contenus masqués sont ceux des champs typés explicitement liés. Un changement de valeur n’est donc pas confondu avec une réécriture de règle.
- Une clause modifiée, une révision Word non résolue, un ajout hors clauses ou un changement d’ordre suspend le résultat. Les notes, en-têtes et pieds de page sont inclus dans la détection des modifications textuelles.
- Le moteur reçoit les valeurs courantes et une citation de chaque champ réellement lu. Ses contrôles habituels restent applicables, notamment la prescription en qualification contentieux.
- Le vérificateur n’écrit pas dans le DOCX. Les essais CLI ont vérifié l’égalité de l’empreinte du fichier avant et après exécution.

Le module de liaison fait moins de 200 lignes et ne réimplémente pas l’algèbre du raisonnement. Il dépend de JSZip déjà utilisé dans le projet et de xmldom désormais déclaré explicitement. Docxtemplater et PizZip sont déclarés comme dépendances de développement pour rendre le comparatif reproductible. Python et tiktoken servent uniquement à mesurer les contextes, pas à exécuter le test du DOCX.

## Vérification et commandes

La suite dédiée comprend les tests du moteur existant et vingt-et-un tests d’intégration, de refus et de comportement des outils : 53 réussis sur cette machine, dont le réenregistrement réel avec LibreOffice. Le contrôle TypeScript strict ciblé réussit. Le test qui reproduit la limite de docx-cli 0.24 est sauté si cette version n’est pas installée ; le test LibreOffice est sauté si `soffice` n’est pas disponible. Les succès de ces tests négatifs signifient que les limites attendues ont été reproduites, pas que toutes les solutions sont compatibles.

Depuis la racine de `feat/plugin-raisonnement`, avec Node 24 :

```sh
npm run test:reasoning-docx
npm run reasoning:docx -- /chemin/document-lie.docx --offline
npm run reasoning:docx -- /chemin/document-lie.docx
```

Le dernier appel active les connecteurs de sources existants. En mode hors ligne, les sources externes non relues restent des limites visibles. Les parties du dossier et les évaluations de fiabilité de l’avocat ne sont pas chargées par cette commande autonome.

Codes de sortie : 0 pour un test exécuté sans erreur d’écriture, 1 pour une erreur ou un fichier non pris en charge, 2 pour un document dont le modèle doit être revu. Un code 0 ne signifie pas que tous les manques juridiques sont levés : consulter `bilan` et `alertes`.

Reproduction du comparatif :

```sh
npx --no-install tsx --tsconfig server/tsconfig.json scripts/piecemaker/benchmark-docx-reasoning.mts /tmp/comparatif-docx /chemin/docx-0.27
python3 scripts/piecemaker/measure-docx-context.py /tmp/comparatif-docx
```

Les sorties sont `results.json`, `payloads.json`, `tokens.json` et les DOCX fictifs. Les exemples d’usage livrés sont entièrement fictifs et restent hors dépôt.

## Limites à conserver visibles

Le chemin est un prototype opt-in en ligne de commande. Il n’est pas encore branché au volet Raisonnement ni à l’enregistrement automatique de l’éditeur. Il ne reprend pas automatiquement un DOCX quelconque sans modèle ni ancres ; il le refuse. Les liaisons de faits booléens et l’édition d’un modèle embarqué dans l’interface restent à concevoir.

Les réenregistrements par EigenPal et LibreOffice sont testés ; le cycle d’ouverture et sauvegarde dans Microsoft Word lui-même ne l’est pas. Le format retenu est natif du DOCX, mais ce seul fait ne remplace pas ce test. L’effacement des propriétés ou la duplication d’ancres doit toujours produire un refus, jamais une validation implicite.

La vérification juridique complète reste celle du moteur et des sources accessibles. Le scénario de mesure est arithmétique, pas un avis juridique. Ce travail ne corrige pas les cinq défauts du précédent audit du moteur et ne les transforme pas en garanties de production.
