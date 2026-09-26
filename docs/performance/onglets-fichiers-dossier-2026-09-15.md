# Évaluation des onglets Fichiers et Dossier

Mesure effectuée le 15 septembre 2026 sur l’instance de développement locale, avec le dossier `piecemaker-droit-francais` sélectionné. Les temps réseau incluent la réception complète du corps de réponse. Les temps d’interface sont mesurés entre le clic et deux rendus React suivis d’une période réseau stable de 150 ms.

## Résultat

| Mesure | Dossier | Fichiers |
| --- | ---: | ---: |
| Onglet sélectionné et peint, médiane de 5 ouvertures | 49,9 ms | 49,7 ms |
| Vue stabilisée, médiane de 5 ouvertures | 233,3 ms | 349,6 ms |
| Requêtes au clic, à chaud | 0 | 1 réussie et 1 annulée par React Strict Mode |
| Requête propre à la vue, médiane hors concurrence | `/repository/case` : 690,6 ms | `/files` : 63,1 ms |
| Corps de la réponse principale | 474 522 octets | 447 373 octets |

Le changement visuel de l’onglet coûte environ 50 ms dans les deux cas. La vue Fichiers demande ensuite environ 116 ms de plus pour relire, transférer, parser et rendre l’arbre. Sur cinq allers-retours, sa requête réussie a pris 123,7 à 143,8 ms dans le contexte de l’interface, avec une médiane de 126,5 ms.

Dossier paraît plus rapide parce que son travail est déplacé avant le clic. Dès qu’un dossier CloudCLI est sélectionné, `useSelectedDossierRegistration` charge `/repository`, puis précharge en parallèle `/repository/case`, `/mapping` et `/configuration`. Les composants de l’onglet partagent ces promesses et leurs valeurs pendant 30 secondes. L’ouverture de Dossier n’a donc produit aucune requête pendant les six ouvertures mesurées.

Fichiers ne conserve aucun snapshot. `WorkspaceMain` démonte `FileTree` dès qu’un autre onglet est affiché. Son remontage relance systématiquement `useFileTreeData`, donc `GET /api/file-tree/projects/:projectId/files?respectGitignore=true` à chaque ouverture.

## Chaîne d’appels de Fichiers

1. Le clic exécute `setActiveTab('files')` dans `WorkspaceTabs`.
2. `WorkspaceMain` monte `FileTree` uniquement lorsque `activeTab === 'files'`.
3. `FileTree` appelle `useFileTreeData` et ses hooks locaux de recherche, d’expansion, d’opérations, de vue et d’upload. Seul `useFileTreeData` émet une requête à l’ouverture.
4. `useFileTreeData.fetchFiles` appelle `api.getFiles`, puis `authenticatedFetch`.
5. La route `/api/file-tree/projects/:projectId/files` appelle `listProjectFiles`.
6. `listProjectFiles` résout le chemin depuis l’identifiant en base, vérifie son accès, lit `.gitignore`, puis appelle `buildFileTree` avec une profondeur maximale de 10.
7. `buildFileTree` ouvre chaque dossier visible, applique `.gitignore`, effectue un `lstat` par entrée, descend récursivement, trie les entrées et renvoie au plus 10 000 éléments.
8. Le client parse le JSON et rend récursivement `FileTreeBody`, `FileTreeList` et `FileTreeNode`.

En développement, React Strict Mode monte, nettoie et remonte l’effet. La première requête observée est donc annulée par `AbortController`, puis la seconde aboutit. Ce doublon annulé ne représente pas le comportement attendu du build de production.

## Chaîne d’appels de Dossier

1. La sélection du dossier monte `WorkspaceMain`, qui appelle toujours `useSelectedDossierRegistration`, quel que soit l’onglet actif.
2. `ensureDossierRegistration` appelle `/repository`. La réponse mesurée a une médiane de 4,3 ms.
3. Une fois le dossier juridique trouvé, le hook précharge `/repository/case`, `/mapping` et `/configuration` avec `pmGetCached`.
4. Au clic sur Dossier, `DossierCasesProvider` réutilise l’enregistrement et son snapshot.
5. `CaseFilesSection` et `CaseMappingSetup` demandent `/repository/case`, `CaseMappingSection` demande `/mapping`, et `CaseMappingSetup` demande `/configuration`. Le cache fusionne les appels identiques et renvoie les valeurs déjà chargées.

Mesures directes après stabilisation :

| Endpoint | Médiane | Minimum | Maximum | Taille |
| --- | ---: | ---: | ---: | ---: |
| `/api/piecemaker/repository` | 4,3 ms | 3,8 ms | 4,6 ms | 3 453 octets |
| `/api/piecemaker/repository/case` | 690,6 ms | 633,3 ms | 880,9 ms | 474 522 octets |
| `/api/piecemaker/mapping` | 4,9 ms | 4,6 ms | 6,5 ms | 200 octets |
| `/api/file-tree/.../files` | 63,1 ms | 61,0 ms | 66,4 ms | 447 373 octets |
| `/api/piecemaker/configuration` | 10 549,2 ms | 10 407,2 ms | 10 551,0 ms | 6 166 octets |

## Anomalie dominante

Le préchargement de `/configuration` est le principal problème. Il prend environ 10,5 secondes et exécute `configurationOverview`, qui lance `claude --version` puis `codex --version` avec deux `spawnSync` limités chacun à trois secondes. Ces appels synchrones bloquent la boucle Node et retardent les autres routes pendant leur exécution. La fonction interroge ensuite Ollama avec des délais de 1,8 et 2,5 secondes et inspecte plusieurs états locaux.

Lors de la sélection initiale, la requête Fichiers a ainsi pris 15,6 secondes alors que le même endpoint, mesuré seul après stabilisation, prend 63,1 ms en médiane. Plusieurs requêtes sans rapport ont subi le même délai. La lenteur froide perçue de Fichiers provient donc surtout du préchargement Dossier, puis du parcours d’arbre lui-même.

## Priorités proposées

1. Retirer `/configuration` du préchargement global de `useSelectedDossierRegistration`. Charger cet état au montage de `CaseMappingSetup`, ou exposer un endpoint léger limité à l’état GLiNER utilisé par ce bouton.
2. Remplacer les deux `spawnSync` de `configurationOverview` par des processus asynchrones et mettre le résultat de configuration en cache avec une invalidation explicite après installation.
3. Conserver l’arbre Fichiers par `projectId` pendant les changements d’onglet, avec invalidation après création, renommage, suppression ou upload. Cela supprimera la requête et le rerendu récursif des ouvertures répétées.
4. Réduire `/repository/case`, dont les 475 Ko et les 691 ms sont principalement payés en avance, en séparant l’aperçu du dossier et la liste détaillée des pièces si le coût froid reste visible après correction de `/configuration`.
