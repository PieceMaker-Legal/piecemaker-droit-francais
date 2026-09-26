# Anonymisation PieceMaker — chemin retenu

Un seul enchaînement construit le mapping et un seul point de passage code
les messages. Le modèle ne voit que des codes ; le cabinet ne voit que des
noms. Les fichiers restent en clair sur le disque.

Depuis la consolidation, `POST /knowledge/scan` est la **seule** porte de la
conversion : l'UI, le CLI `piecemaker conversion` et l'outil MCP `conversion`
y aboutissent tous. Il n'existe plus de conversion Markdown sans scan.

---

## Vue d’ensemble

```mermaid
flowchart TD
  UI["UI Anonymiser"] --> API["POST /knowledge/scan"]
  CLI["piecemaker conversion · outil MCP"] --> LOCAL["POST /api/piecemaker/local/scan — loopback"]
  LOCAL --> API
  API --> LIST["listOriginals — pièces récursives"]
  LIST --> LOCK["runManagedPythonJob — un GLiNER à la fois"]
  LOCK --> PY["convert_and_scan_pipeline.py"]
  PY --> MD["smart_converter.py — markitdown / MinerU"]
  PY --> SCAN["scanner_worker.py — GLiNER2.5"]
  SCAN --> JSON["mapping_default.json + central-mapping.json"]
  SCAN --> SQL["SQLite piecemaker_mappings"]
  JSON --> HOOK["protect-originals — refuse un dossier sans mapping"]
  SQL --> DICT["sqlite-dictionary.cjs"]
  DICT --> BRIDGE["rewriter-bridge.cjs — réécrivain"]
  BRIDGE <--> PROXY["hudsucker — piecemaker-hudsucker"]
  PROXY -->|"applyMapping"| UP["Fournisseur"]
  UP -->|"revertMapping"| DOWN["Client local"]
```

---

## 1. Lancement

Surfaces : `AnonymizationLauncher`, `CaseMappingSetup`, `CaseFilesChronology`,
plugin dossier. Toutes posent `POST /api/piecemaker/knowledge/scan`
(`createKnowledgeRouter`, `createKnowledgeService.scan`).

Le service démarre un job (`createKnowledgeScanJobs`) puis appelle
`createKnowledgePipeline.scan`. Un scan déjà en cours sur le même projet est
réutilisé. Deux dossiers distincts partagent le verrou GLiNER de
`runManagedPythonJob` : le second attend.

Sans liste de fichiers, `defaultScanFiles` réutilise `listOriginals` : arborescence
complète, hors Markdown généré, hors ressources. `--skip-existing` évite de
recharger GLiNER sur un dossier déjà scanné. Une liste explicite force le
retraitement de ces pièces.

## 2. Markitdown / GLiNER

`runManagedPythonJob` lance `convert_and_scan_pipeline.py` (exclusivité GLiNER,
budget RAM, nice, timeout).

- Phase CONVERT : `smart_converter.py` (`auto` → markitdown si couche texte,
  MinerU sinon).
- Phase SCAN : `scanner_worker.py` charge GLiNER2.5 **une fois**,
  puis scanne chaque Markdown (protocole JSON-line). Les cartes brutes
  (`*_sensitive_map.json`) restent dans un répertoire temporaire et sont
  détruites après fusion.

État technique : `.piecemaker/anonymization-state.json` et
`.piecemaker/document-index.json` du dossier, pas un temp jeté.

## 3. SQLite et mapping disque

Après un scan réussi, le pipeline fait les deux écritures :

| Cible | Module | Consommateur |
| --- | --- | --- |
| `piecemaker_mappings` / `piecemaker_nodes` | `persistScanResult` | proxy PII (`createSqliteDictionaryLoader`) |
| `Fichiers convertis PieceMaker/mapping_default.json` | `writeCaseMapping` | `protect-originals` (`caseHasMapping`), Cursor |
| `~/.piecemaker/central-mapping.json` | `syncCentralMapping` | garde Cursor, rechargement historique |

Sans le JSON, le hook PreToolUse traiterait le dossier comme non anonymisé.
Sans SQLite, le proxy relayerait en clair.

## 4. Proxy PII

La substitution n’a jamais lieu dans un hook. `protect-originals.mjs` refuse
les originaux protégés et un dossier sans `mapping_default.json`.

Démarré avec le serveur (`createAnonymizerService`, `startRequiredAnonymizer`).
Deux pièces, un seul cycle de vie :

- `hudsucker-proxy/` (Rust) : proxy HTTPS d’interception avec l’autorité locale
  `~/.piecemaker/certs/`. N’intercepte que `api.anthropic.com`,
  `api.openai.com`, `chatgpt.com` (et l’hôte de `ANTHROPIC_BASE_URL` s’il est
  distant) ; tout le reste passe en tunnel `CONNECT` sans être lu.
- `rewriter-bridge.cjs` : réécrivain local, dans le processus serveur, que
  hudsucker appelle pour chaque corps JSON, flux SSE et trame WebSocket.

Cycle de vie :

- hudsucker écoute un port choisi par le système (`127.0.0.1:0`) et n’annonce
  `listening` qu’une fois le port ouvert. L’app de bureau et le serveur de dev
  ont chacun leur proxy, sans conflit.
- hudsucker lit son stdin : quand le serveur meurt, même tué net, le tube se
  ferme et hudsucker s’arrête. Il ne peut pas survivre à PieceMaker.
- `GET /health` sur le port du proxy vérifie aussi le réécrivain (200 / 503).

Routage : uniquement par l’environnement du processus serveur
(`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `CODEX_CA_CERTIFICATE`,
`SSL_CERT_FILE`…), hérité par le chat et les terminaux intégrés. Aucun fichier
de configuration client n’est écrit : une session ouverte hors de PieceMaker
part en direct ; une session ouverte par PieceMaker ne peut pas contourner le
proxy, et échoue s’il est arrêté. Au démarrage, `removeLegacyProxyConfig`
retire les traces des versions précédentes (`HTTPS_PROXY` dans
`~/.claude/settings.json`, hooks `proxy-guard.mjs`, `mikePiiPort`).

Échec fermé : un corps vers un hôte intercepté est décompressé
(gzip, br, zstd, deflate) avant réécriture ; un encodage inconnu, un corps non
JSON ou un réécrivain injoignable sont refusés et journalisés
(`[piecemaker] hudsucker : refus …`), jamais relayés en clair. Une trame
WebSocket non anonymisable ferme la connexion (1011).

Le réglage `anonymizer.enabled: false` dans `~/.piecemaker/config.json`
désactive le démarrage du proxy et laisse les échanges avec les fournisseurs
partir directement. La commande
`node scripts/piecemaker/cli/disable-anonymizer.mjs` applique ce réglage.
La protection des pièces reste indépendante de ce choix.

- Sortant : `anonymize` → `applyMapping` (`substitution.cjs`, plus longue
  entité d’abord, frontières Unicode).
- Entrant : `deanonymize` → `revertMapping`, y compris SSE fragmenté
  (`rewrite.cjs`, `createSseRewriter`).
- Dictionnaire : SQLite, rechargé sur `data_version`. Mapping vide = relais
  transparent.

Cursor n’est pas interceptable : un shim `~/.piecemaker/bin/cursor-agent`,
placé en tête du `PATH` du serveur seulement, le bloque tant qu’un mapping
existe.

---

## Performance du scan

Inférence officielle GLiNER2 : **PyTorch**. CUDA s’il y a un GPU NVIDIA, sinon
CPU. Pas de CoreML (API Apple, hors doc Fastino).

Le temps est dans l’encodeur, pas dans le glue Python. `--skip-existing` évite
de recharger GLiNER sur un dossier déjà scanné. `classify_text` par occurrence
a été retiré ; il reste un appel sur l’en-tête (nature / date).

---

## Invariants

- Un seul worker GLiNER à la fois, tous dossiers confondus.
- Substitution triée de l’entité la plus longue à la plus courte.
- Un code n’est jamais réattribué ; les collisions inter-dossiers sont
  dé-conflictées dans `sqlite-dictionary.cjs`.
- Les originaux ne quittent pas le dossier ; seuls Markdown + codes partent
  vers le modèle.
- Le harnais de citations observe le clair **avant** anonymisation et **après**
  ré-identification (`harness-legal.md`).
