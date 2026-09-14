• Explored
  └ Search function writeLegalInputs|function legalGraphEnvironment|function topologySemanticDocuments|function topologyDocumentRecords|function applyMapping|function readCaseMapping in legal-graph.cjs
    Read legal-graph.cjs
    Read legal-graph.cjs
    Read smart_converter.py
    Read legal-graph.cjs, smart_converter.py

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Le pipeline des graphes juridiques comporte deux graphes distincts :

  - le graphe documentaire, déterministe, fondé sur GLiNER ;
  - le graphe juridique riche, sémantique, construit par Graphify avec le corpus pseudonymisé.

  ## 1. Conversion des pièces en Markdown

  L’entrée est une pièce originale : PDF, DOCX, image, tableur, etc.

  Le script server/piecemaker/vendor/websocket-server/scripts/smart_converter.py choisit le moteur :

  1. Images : toujours MinerU, car elles nécessitent de l’OCR.
  2. PDF : inspection des trois premières pages avec pypdf.
      - couche texte exploitable : MarkItDown ;
      - absence de texte : MinerU.

  3. DOCX, PPTX, XLSX, TXT, HTML, CSV : MarkItDown.
  4. --engine peut forcer markitdown ou mineru.

  MarkItDown produit un fichier Markdown dérivé. Le Markdown est ensuite normalisé :

  - conversion des fins de ligne ;
  - remplacement des espaces insécables et caractères invisibles ;
  - fusion des lignes artificiellement coupées par la mise en page PDF ;
  - conservation des titres, tableaux, listes, citations et blocs de code ;
  - limitation des lignes vides successives.

  Cette normalisation est importante car les positions des entités GLiNER doivent correspondre exactement au Markdown relu plus tard.

  Orchestration : server/piecemaker/vendor/websocket-server/scripts/convert_and_scan_pipeline.py.

  Sortie principale :

  Fichiers convertis PieceMaker/
  ├── piece-1.md
  ├── piece-2.md
  └── ...

  Les originaux restent dans leur emplacement initial.

  ## 2. Analyse GLiNER/Presidio

  Chaque Markdown est transmis à server/piecemaker/vendor/websocket-server/scripts/presidio-gliner/presidio-gliner.py.

  Le scanner :

  1. lit le Markdown en clair ;
  2. détecte la langue ;
  3. exécute les détecteurs de motifs :
      - e-mails ;
      - téléphones ;
      - adresses ;
      - SIREN/SIRET ;
      - IBAN ;
      - URLs ;
      - dates et autres motifs spécialisés ;

  4. exécute Presidio avec le recognizer GLiNER2.5 ;
  5. GLiNER recherche principalement :
      - PERSON ;
      - ORGANIZATION ;
      - LOCATION ;

  6. les textes sont traités par blocs pour respecter la limite de contexte ;
  7. les offsets locaux de chaque bloc sont reconvertis en offsets absolus dans le Markdown ;
  8. les doublons sont fusionnés ;
  9. les chevauchements entre entités sont arbitrés ;
  10. les organisations peuvent recevoir une forme juridique détectée littéralement :
      - ORGANIZATION_SA ;
      - ORGANIZATION_SARL ;
      - etc.

  Le résultat temporaire par pièce est de la forme :

  piece-1_sensitive_map.json

  Il contient les textes détectés, leurs positions et leurs scores. Ces fichiers sont conservés uniquement dans un répertoire temporaire privé.

  Le modèle GLiNER est chargé une seule fois par le scanner_worker.py pour traiter plusieurs pièces.

  ## 3. Construction du mapping d’anonymisation

  Le pipeline fusionne ensuite les résultats individuels :

  1. lecture des cartes GLiNER temporaires ;
  2. consolidation des variantes d’un même nom ;
  3. attribution de codes pseudonymisés ;
  4. fusion avec le mapping existant ;
  5. sauvegarde de :

  mapping_default.json

  Le mapping contient conceptuellement :

  {
    "mapping": {
      "Jean Dupont": "PERSONNE_001",
      "Société Exemple": "SOCIETE_001"
    },
    "reverse_mapping": {
      "PERSONNE_001": "Jean Dupont",
      "SOCIETE_001": "Société Exemple"
    }
  }

  Le fichier réel possède davantage de métadonnées, mais cette séparation est essentielle :

  - mapping : texte réel vers code ;
  - reverse_mapping : code vers libellé affichable.

  Les cartes sensibles par document sont ensuite supprimées. Le pipeline conserve à la place :

  .piecemaker/anonymization-state.json
  .piecemaker/document-index.json

  document-index.json associe chaque pièce à :

  - son identifiant opaque ;
  - sa nature ;
  - sa date ;
  - sa juridiction ;
  - les codes GLiNER détectés ;
  - les codes effectifs après validation ;
  - l’état de conversion et d’anonymisation.

  Aucun nom de fichier original n’est nécessaire pour le graphe : les pièces sont identifiées par une empreinte.

  ## 4. Sélection du périmètre juridique

  Avant Graphify, server/piecemaker/vendor/websocket-server/legal-graph.cjs reconstruit la topologie du dossier.

  Il applique le registre des parties sélectionnées par l’avocat :

  - seules les parties explicitement sélectionnées deviennent des identités centrales ;
  - un témoin, dirigeant, signataire ou tiers détecté par GLiNER ne devient pas automatiquement une partie ;
  - les pièces mentionnant une partie sélectionnée peuvent entrer dans le corpus sémantique ;
  - les pièces de Correspondance et Data Room bénéficient d’un statut prioritaire ;
  - les pièces sans partie sélectionnée restent éventuellement dans la couche documentaire, mais sont exclues de l’analyse juridique riche ;
  - les pièces non converties, non scannées ou au contenu vide sont marquées indisponibles.

  Sans mapping valide ou sans parties sélectionnées, le graphe juridique riche n’est pas construit.

  ## 5. Ré-identification interne du Markdown

  Pour chaque pièce éligible :

  1. le serveur retrouve son Markdown converti ;
  2. il lit le Markdown ;
  3. il applique le mapping réel → code ;
  4. il obtient un contenu pseudonymisé ;
  5. il calcule une empreinte de ce contenu.

  Graphify ne reçoit donc jamais :

  - le PDF ou DOCX original ;
  - les noms réels ;
  - les chemins locaux ;
  - le mapping complet ;
  - les secrets Legifrance ou autres secrets applicatifs.

  Le contenu envoyé ressemble à ceci :

  # PIECE_A1B2C3D4E5F6 — contrat — 2024-01-03

  - document_id: PIECE_A1B2C3D4E5F6
  - parties_explicites: PERSONNE_001 (demandeur/...)
  - contenu_anonymise_disponible: oui

  ## Contenu pseudonymisé

  PERSONNE_001 conclut un contrat avec SOCIETE_001...

  Le fichier est créé dans un répertoire temporaire avec un nom dérivé de l’empreinte de la pièce.

  ## 6. Préparation du corpus Graphify juridique

  Le corpus temporaire comprend :

  corpus/
  ├── <empreinte-1>.md
  ├── <empreinte-2>.md
  └── cadre_juridique_francais.md

  Le fichier cadre_juridique_francais.md (server/piecemaker/vendor/websocket-server/legal-graph.cjs) contient le socle juridique français déterministe, notamment des références au Code civil.

  Un entity-map.json est également créé. Pour le graphe juridique, il ne contient que le registre sûr des parties :

  - codes pseudonymisés ;
  - position procédurale ;
  - côté ;
  - type d’entité.

  Il ne contient pas les noms réels.

  ## 7. Extraction sémantique par Graphify

  Graphify est lancé ainsi, conceptuellement :

  graphify extract <corpus>
    --mode deep
    --no-cluster
    --entity-map <entity-map.json>
    --entity-map-labels canonical
    --max-concurrency 1
    --token-budget 20000
    --api-timeout 600
    --out <output>

  Contrairement au graphe documentaire GLiNER, cette étape utilise l’extraction sémantique Graphify et peut utiliser le backend/modèle configuré.

  Le prompt juridique PieceMaker est injecté via server/piecemaker/vendor/websocket-server/legal-graph-prompt.txt et server/piecemaker/vendor/websocket-server/scripts/graphify-legal-sitecustomize.py.

  Le prompt impose notamment :

  - JSON uniquement ;
  - une source pour chaque nœud et chaque relation ;
  - aucune identité inventée ;
  - seules les parties de l’en-tête parties_explicites sont autorisées comme identités ;
  - distinction entre fait extrait et inférence ;
  - statut A_VERIFIER pour les qualifications incertaines ;
  - relations juridiques typées ;
  - conservation des positions et sources.

  Les nœuds peuvent représenter :

  - contrats ;
  - actes juridiques ;
  - obligations ;
  - prestations ;
  - exécutions ;
  - inexécutions ;
  - dommages ;
  - demandes ;
  - sanctions ;
  - prétentions ;
  - arguments ;
  - contestations ;
  - questions juridiques ;
  - normes ;
  - décisions ;
  - faits ;
  - preuves.

  Le résultat brut attendu est :

  output/graphify-out/graph.json

  ## 8. Contrôle et matérialisation PieceMaker

  Graphify ne devient pas directement le graphe final. Le serveur passe sa sortie par le matérialiseur :

  server/piecemaker/vendor/websocket-server/legal-graph-materializer.cjs

  Puis par finalizeLegalGraph() dans legal-graph.cjs.

  Cette phase :

  1. vérifie la structure JSON ;
  2. normalise links vers edges si nécessaire ;
  3. supprime les chemins privés ;
  4. rejette les sources qui ne correspondent pas aux pièces autorisées ;
  5. vérifie les codes d’identité ;
  6. interdit les arêtes vers des nœuds inexistants ;
  7. vérifie les hyperarêtes ;
  8. limite les relations à la liste autorisée ;
  9. sépare les identités autorisées des tiers contextuels ;
  10. ajoute les nœuds déterministes des pièces et des parties ;
  11. ajoute les liens document ↔ partie provenant de GLiNER ;
  12. ajoute le cadre juridique français ;
  13. marque les éléments nécessitant une révision humaine.

  Le graphe final combine donc :

  couche déterministe
    pièces
    parties validées
    mentions GLiNER
    métadonnées
    cadre légal

  +

  couche sémantique Graphify
    contrats
    obligations
    demandes
    arguments
    inexécutions
    preuves
    relations juridiques

  Il est enregistré ici :

  .piecemaker/graphify/legal/graphify-out/graph.json

  Le fragment sémantique original est conservé séparément :

  .piecemaker/graphify/legal/semantic-snapshot/graph.json

  Le manifeste associé permet de savoir si le graphe est à jour.

  ## 9. Fraîcheur et reconstruction

  La reconstruction est pilotée par une signature comprenant notamment :

  - les parties sélectionnées ;
  - les pièces incluses ;
  - les codes de parties ;
  - la nature et la date des pièces ;
  - le contenu pseudonymisé ;
  - le hash du prompt ;
  - la version de l’intégration ;
  - la version du finalizer.

  Le graphe est marqué périmé si changent :

  - le mapping ;
  - les parties sélectionnées ;
  - le Markdown converti ;
  - les décisions GLiNER ;
  - le prompt juridique ;
  - le cadre juridique ;
  - la version du finalizer.

  graphe_question peut utiliser le graphe existant, mais ne reconstruit pas silencieusement un graphe périmé. Dans ce cas, il faut appeler graphe_construire.

  ## Distinction importante

  Le graphe documentaire GLiNER est construit sans LLM :

  Markdown → GLiNER → codes d’entités → graphe documentaire

  Le graphe juridique riche suit un autre chemin :

  Markdown original
  → conversion et normalisation
  → GLiNER et mapping
  → application du mapping
  → sélection des parties
  → corpus pseudonymisé
  → Graphify en mode deep
  → validation PieceMaker
  → graphe juridique final

  Graphify reçoit donc bien le texte juridique pseudonymisé pour le graphe riche. Il ne reçoit uniquement les codes GLiNER que pour le graphe documentaire déterministe.
