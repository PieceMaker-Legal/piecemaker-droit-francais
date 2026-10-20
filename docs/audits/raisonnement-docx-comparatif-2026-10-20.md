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
- Les contrôles liés reçoivent `sdtLocked` : Word peut modifier leur contenu, mais leur suppression nécessite de retirer cette protection. Les contrôles temporaires sont désactivés pour éviter leur disparition au premier remplacement. Cette protection dépend de son respect par l’éditeur ; ce n’est pas une garantie contre l’effacement volontaire.
- Chaque clause reçoit aussi un signet Word couvrant son texte complet. LibreOffice transforme les contrôles de bloc imbriqués et peut ne laisser dans le contrôle de clause que son début. Le signet conserve la portée complète après cette transformation, évitant des alertes sur les clauses inchangées et un contexte tronqué pour la clause réécrite.
- Une sauvegarde EigenPal suivant ce passage LibreOffice peut ensuite supprimer les signets. Les nouveaux documents reçoivent donc un contrôle de fin de clause permanent, protégé et sans texte visible. Le lecteur privilégie cette portée et exige ces contrôles lorsque les métadonnées de liaison déclarent `anchors: 'sdt-end'`. Une disparition, duplication ou modification ne valide jamais implicitement la portée précédente. Les anciens documents sans cette déclaration gardent la lecture par signets ; ils ne sont pas migrés automatiquement.
- Les empreintes de texte conservent les mots et la ponctuation. Les seuls contenus masqués sont ceux des champs typés explicitement liés. Un changement de valeur n’est donc pas confondu avec une réécriture de règle.
- Une clause modifiée, une révision Word non résolue, un ajout hors clauses ou un changement d’ordre suspend le résultat. Les notes, en-têtes et pieds de page sont inclus dans la détection des modifications textuelles.
- Le moteur reçoit les valeurs courantes et une citation de chaque champ réellement lu. Ses contrôles habituels restent applicables, notamment la prescription en qualification contentieux.
- Le vérificateur n’écrit pas dans le DOCX. Les essais CLI ont vérifié l’égalité de l’empreinte du fichier avant et après exécution.

Le module de liaison fait environ 260 lignes et ne réimplémente pas l’algèbre du raisonnement. Il dépend de JSZip déjà utilisé dans le projet et de xmldom désormais déclaré explicitement. Docxtemplater et PizZip sont déclarés comme dépendances de développement pour rendre le comparatif reproductible. Python et tiktoken servent uniquement à mesurer les contextes, pas à exécuter le test du DOCX.

## Vérification et commandes

La suite dédiée comprend les tests du moteur existant et vingt-six tests d’intégration, de refus et de comportement des outils : 58 réussis sur cette machine. Les trois cycles LibreOffice couvrent le document inchangé, une valeur modifiée et une clause réécrite. Un autre essai enchaîne retouche de valeur et de clause, sauvegarde EigenPal, puis restauration du texte : le modèle est conservé et le calcul reprend avec la valeur courante. Les retouches de test sont injectées dans le XML avant un réenregistrement réel ; elles ne simulent pas les gestes du clavier dans l’interface de Word. Le contrôle TypeScript strict ciblé réussit. Le test qui reproduit la limite de docx-cli 0.24 est sauté si cette version n’est pas installée ; les tests LibreOffice sont sautés si `soffice` n’est pas disponible. Les succès de ces tests négatifs signifient que les limites attendues ont été reproduites, pas que toutes les solutions sont compatibles.

Une session distincte `gpt-6-luna`, demandée par le propriétaire, a relancé la suite sur le commit `e7944352` avec Node 24.11.1 : 58 réussis, aucun échec. Son essai supplémentaire remplace le prix fictif `12 000 EUR` par `12 500 €` avec espace fine insécable U+202F, puis réenregistre avec LibreOffice. Le modèle est conservé, le statut reste `testé`, aucune clause n’est signalée modifiée et la pénalité est recalculée à 375. Cet essai reste un test arithmétique avec retouche XML et sauvegarde réelle, sans interaction avec l’interface Word. Les prochains essais de ce chantier doivent également être exécutés par Luna, conformément à `AGENTS.md`.

### Retouches successives éprouvées par Luna

Une seconde session `gpt-6-luna` a reproduit deux défauts supplémentaires, puis rejoué les cas après correction de la seule liaison DOCX :

- Une révision en attente dans une note pouvait être rattachée puis déclarée `testé`, car seuls les marqueurs du corps étaient inspectés. Le contrôle couvre désormais aussi les notes de bas de page et de fin, les en-têtes et les pieds de page.
- La chaîne EigenPal → LibreOffice → modification d’une clause → EigenPal pouvait perdre les signets et tronquer les extraits avant les valeurs. Les contrôles de fin permanents conservent maintenant le passage complet ; seule la clause effectivement réécrite est signalée.

Les champs Word simples contenant une instruction ne fournissent plus silencieusement leur résultat en cache comme donnée fixe. Ils sont refusés dans une liaison numérique ou date, comme les champs complexes. Une instruction changée hors d’une valeur liée déclenche une revue même si le texte affiché reste identique. Aucune règle juridique, formule, hypothèse, instruction d’agent ou source du moteur n’a été modifiée. Les tests comparent le code embarqué à l’original et les octets reçus avant/après vérification.

Luna a également vérifié la chaîne avec seules les valeurs modifiées : montant calculé 1 440, code embarqué inchangé. La commande autonome sort avec le code 0 sur la fixture inchangée et le code 2 sur une clause réécrite ; les empreintes des deux fichiers restent identiques avant/après la commande. Les sorties de cette campagne restent hors dépôt dans le dossier d’audit local.

Bilan final de cette seconde campagne : `npm run test:reasoning-docx` exécuté par `gpt-6-luna` sous Node 24.11.1, 65 tests réussis, aucun échec ni test ignoré. Le déplacement du seul repère de fin, sans changement du texte global, impose également la revue de la clause concernée. Les tests du moteur existant restent inclus sans aucune modification de leurs sources ; le contrôle TypeScript strict ciblé réussit.

Une tentative du parent dans Microsoft Word n’a pas abouti : le dialogue prévisualisait la copie fictive mais gardait son bouton d’ouverture désactivé, puis les appels d’accessibilité ont expiré. Ce n’est pas un cycle Word validé ni la preuve d’un défaut de son format ; aucun enregistrement Word n’est annoncé.

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

Le prototype reste accessible en ligne de commande. Le contrôle local est désormais aussi branché à l’ouverture et à l’enregistrement automatique de l’éditeur DOCX, avec son état et ses détails dans l’éditeur (voir `docs/docx.md`). Il n’est pas branché au graphe du volet Raisonnement. Il ne reprend pas automatiquement un DOCX quelconque sans modèle ni ancres. Les liaisons de faits booléens, la préparation des ancres et l’édition d’un modèle embarqué dans l’interface restent à concevoir.

Les réenregistrements par EigenPal et LibreOffice sont testés ; le cycle d’ouverture et sauvegarde dans Microsoft Word lui-même ne l’est pas. Le format retenu est natif du DOCX, mais ce seul fait ne remplace pas ce test. L’effacement des propriétés ou la duplication d’ancres doit toujours produire un refus, jamais une validation implicite.

La vérification juridique complète reste celle du moteur et des sources accessibles. Le scénario de mesure est arithmétique, pas un avis juridique. Ce travail ne corrige pas les cinq défauts du précédent audit du moteur et ne les transforme pas en garanties de production.
