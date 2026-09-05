'use strict';

/**
 * Résolveurs de texte source pour la vérification des citations
 * (`verify-citations.cjs`) — l'équivalent PieceMaker du « turn state »
 * CourtListener de Mike
 * (`backend/src/lib/chat/tools/courtlistenerTurnState.ts`), qui mettait en
 * cache le texte des opinions lues pendant le tour de chat pour que la
 * vérification porte exactement sur ce que le modèle a réellement lu.
 *
 * Chez PieceMaker il n'y a pas de boucle de chat : le texte intégral est déjà
 * sur le disque, déposé soit par le MCP Légifrance (décisions), soit par le
 * pipeline de conversion du dossier (pièces). Ce module ne fait donc que
 * résoudre un identifiant vers son texte de référence — AUCUN LLM, AUCUNE
 * ANALYSE, c'est purement mécanique, à l'image de `legifrance-reads.cjs`.
 *
 * Contrat de robustesse : aucune fonction exportée ne lève jamais. Un fichier
 * illisible, un JSON/JSONL invalide, un identifiant inconnu ou un chemin hors
 * périmètre renvoient toujours une valeur « vide » (chaîne vide ou Map vide),
 * jamais une exception. `verify-citations.cjs` traite une source vide comme
 * « pas de source » (`verified: false`) — jamais un faux positif.
 *
 * ---------------------------------------------------------------------------
 * Décisions Légifrance — `createDecisionTextResolver(roots)`
 * ---------------------------------------------------------------------------
 * Cherche, sous les racines fournies, les dossiers marqués
 * `.legifrance-results.json` produits par le MCP `mcp-legifrance`
 * (dépôt de référence : `tools/research_corpus.py` et `tools/bulk_download.py`)
 * et y indexe `decisionId -> texte`.
 *
 * Deux formes de dossier, distinguées par `kind` dans le marqueur :
 *   - `legifrance-research` (Build_Research_Corpus) : `decisions.jsonl`, une
 *     décision par ligne, champ `texte` = texte intégral réel.
 *   - `legifrance-results` (Download_Query_Results) : `results.json`, un
 *     tableau d'entrées. ÉCART AU MODÈLE ORIGINAL : contrairement à ce qu'on
 *     pourrait attendre, ces entrées n'ont PAS de champ `texte` — l'outil ne
 *     télécharge jamais le texte intégral pour cette forme (voir
 *     `_extract_entry` dans `bulk_download.py` : seuls `id`, `titre`, `lien`,
 *     `date`, `analyse` — un sommaire — `articles`, et optionnellement
 *     `solution.dispositif` — un extrait du dispositif seul, jamais les
 *     motifs — sont écrits). Le texte de référence reconstitué ici pour cette
 *     forme est donc `titre + dispositif éventuel + analyse/sommaire`, PAS le
 *     texte intégral de la décision. C'est strictement moins que ce que la
 *     forme corpus fournit, mais reste la meilleure source mécaniquement
 *     disponible sur disque pour cette forme — et une vérification qui échoue
 *     par manque de matière est le sens de la marche sûr (`verified: false`),
 *     jamais un faux positif.
 *
 * S'y ajoute une troisième source : le cache `~/.piecemaker/decisions/<id>.json`
 * tenu à jour par le hook `decision-cache.mjs` à chaque appel de l'outil
 * `consulter_decision` — seule des trois façons dont le MCP restitue une
 * décision à écrire son texte intégral au fil de l'eau plutôt que par lot (le
 * texte de `consulter_decision` n'atterrit sinon que dans le résultat
 * d'outil, jamais sur disque). Priorité entre les trois sources pour un même
 * identifiant : corpus (texte intégral réel) > cache `consulter_decision`
 * (texte intégral réel aussi, mais capturé au coup par coup) > téléchargement
 * (matière réduite, en dernier recours). En pratique cet ordre coïncide avec
 * la longueur : le texte le plus long disponible pour l'identifiant l'emporte,
 * l'ordre des sources ne servant qu'à départager une égalité de longueur.
 *
 * La découverte des dossiers marqués réutilise `MARKER_NAME` et
 * `findResultsRoot` de `legifrance-reads.cjs` (stratégie ascendante depuis un
 * chemin donné) et y ajoute une descente bornée (profondeur par défaut 6)
 * depuis chaque racine fournie, en ignorant `node_modules`, `.git`,
 * `__pycache__` et tout dossier caché sauf s'il porte lui-même le marqueur.
 *
 * L'index fusionné est mémoïsé une fois par process pour un jeu de racines
 * donné (clé = racines résolues et triées) : les dossiers sont parcourus du
 * plus récent au plus ancien (mtime du marqueur), et en cas de doublon
 * d'identifiant le plus récent gagne.
 *
 * ---------------------------------------------------------------------------
 * Pièces du dossier — `createDocumentTextResolver(caseRoot, config)`
 * ---------------------------------------------------------------------------
 * Le modèle ne lit jamais un original : il lit la contrepartie Markdown
 * convertie (`case-folder-structure.cjs#structuredMarkdownCounterpart`). Le
 * `doc_id` d'une citation est donc résolu comme un chemin — absolu, ou
 * relatif à `caseRoot` puis, à défaut, au répertoire courant — et lu
 * directement s'il désigne déjà un `.md` existant, sinon via sa contrepartie
 * structurée. Même frontière que `protect-originals.mjs` : tout chemin qui
 * sort de `caseRoot`, ou tout fichier dont l'extension n'est pas `.md`, est
 * refusé et renvoie `''`.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MARKER_NAME, findResultsRoot } = require('./legifrance-reads.cjs');
const { structuredMarkdownCounterpart } = require('./case-folder-structure.cjs');

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '__pycache__']);
const DEFAULT_MAX_DEPTH = 6;

// ---------------------------------------------------------------------------
// Découverte des dossiers marqués (descente bornée + ascendant existant)
// ---------------------------------------------------------------------------

function hasMarker(dir) {
  try {
    return fs.existsSync(path.join(dir, MARKER_NAME));
  } catch {
    return false;
  }
}

/**
 * Descend depuis `dir` (profondeur `depth`, root = 0) jusqu'à `maxDepth`,
 * ajoutant à `found` chaque dossier marqué rencontré. Ne descend jamais dans
 * un dossier déjà marqué (c'est une feuille de résultats), ni dans
 * `node_modules`/`.git`/`__pycache__`, ni dans un dossier caché — sauf si ce
 * dossier caché porte lui-même le marqueur.
 */
function walkDown(dir, depth, maxDepth, found) {
  if (hasMarker(dir)) {
    found.set(dir, true);
    return;
  }
  if (depth >= maxDepth) return;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (IGNORED_DIR_NAMES.has(name)) continue;
    const childDir = path.join(dir, name);
    if (name.startsWith('.')) {
      // Jamais de descente dans un dossier caché — sauf s'il porte lui-même
      // le marqueur, auquel cas on le retient sans aller plus loin.
      if (hasMarker(childDir)) found.set(childDir, true);
      continue;
    }
    walkDown(childDir, depth + 1, maxDepth, found);
  }
}

/**
 * Trouve tous les dossiers marqués `.legifrance-results.json` accessibles
 * depuis `roots` (une racine ou un tableau de racines) : la racine elle-même
 * si elle est marquée, ses ancêtres marqués (stratégie ascendante existante
 * de `legifrance-reads.cjs`), et ses descendants marqués jusqu'à
 * `options.maxDepth` (défaut 6). Renvoie un tableau de chemins absolus,
 * dédoublonné, sans ordre garanti. Ne lève jamais.
 */
function findMarkedFolders(roots, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : DEFAULT_MAX_DEPTH;
  const list = Array.isArray(roots) ? roots : [roots];
  const found = new Map();

  for (const root of list) {
    if (typeof root !== 'string' || !root) continue;
    let resolvedRoot;
    try {
      resolvedRoot = path.resolve(root);
    } catch {
      continue;
    }

    // Stratégie ascendante existante : la racine elle-même, ou un de ses
    // ancêtres, peut déjà être (ou être sous) un dossier marqué.
    try {
      const ancestorMarked = findResultsRoot(path.join(resolvedRoot, '.probe'));
      if (ancestorMarked) found.set(ancestorMarked, true);
    } catch {
      // ignore
    }

    walkDown(resolvedRoot, 0, maxDepth, found);
  }

  return Array.from(found.keys());
}

// ---------------------------------------------------------------------------
// Index decisionId -> texte pour un dossier marqué donné
// ---------------------------------------------------------------------------

function loadCorpusIndex(folder, index) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(folder, 'decisions.jsonl'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue; // ligne JSONL corrompue : ignorée silencieusement.
    }
    if (!record || typeof record !== 'object') continue;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) continue;
    const texte = typeof record.texte === 'string' ? record.texte : '';
    index.set(id, texte);
  }
}

/**
 * Reconstitue le meilleur texte de référence disponible pour une entrée
 * `results.json` (forme Download_Query_Results), qui ne contient pas le
 * texte intégral — voir la note d'écart en tête de fichier.
 */
function downloadEntryText(entry) {
  const parts = [];
  if (typeof entry.titre === 'string' && entry.titre.trim()) parts.push(entry.titre.trim());
  const solution = entry.solution && typeof entry.solution === 'object' ? entry.solution : null;
  if (solution && typeof solution.dispositif === 'string' && solution.dispositif.trim()) {
    parts.push(solution.dispositif.trim());
  }
  if (typeof entry.analyse === 'string' && entry.analyse.trim()) parts.push(entry.analyse.trim());
  return parts.join('\n\n');
}

function loadDownloadIndex(folder, index) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(folder, 'results.json'), 'utf8');
  } catch {
    return;
  }
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) continue;
    index.set(id, downloadEntryText(entry));
  }
}

/**
 * Charge l'index `decisionId -> texte` d'UN dossier marqué, en distinguant
 * les deux formes via `kind` dans le marqueur. Renvoie toujours une Map
 * (vide en cas d'échec ou de forme inconnue) : ne lève jamais.
 */
function loadDecisionIndex(folder) {
  const index = new Map();
  if (typeof folder !== 'string' || !folder) return index;

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(folder, MARKER_NAME), 'utf8'));
  } catch {
    return index;
  }
  const kind = marker && typeof marker === 'object' ? marker.kind : null;

  if (kind === 'legifrance-research') {
    loadCorpusIndex(folder, index);
  } else if (kind === 'legifrance-results') {
    loadDownloadIndex(folder, index);
  }
  // Forme de marqueur inconnue : index vide, silencieusement.

  return index;
}

// ---------------------------------------------------------------------------
// createDecisionTextResolver — mémoïsation par jeu de racines
// ---------------------------------------------------------------------------

const decisionIndexCache = new Map();

function cacheKeyForRoots(roots) {
  const list = Array.isArray(roots) ? roots : [roots];
  return list
    .filter((value) => typeof value === 'string' && value)
    .map((value) => {
      try {
        return path.resolve(value);
      } catch {
        return value;
      }
    })
    .sort()
    .join('\n');
}

function markerMtimeMs(folder) {
  try {
    return fs.statSync(path.join(folder, MARKER_NAME)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Relit uniquement `kind` du marqueur d'un dossier, sans charger son index. */
function markerKind(folder) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(folder, MARKER_NAME), 'utf8'));
    return marker && typeof marker === 'object' ? marker.kind : null;
  } catch {
    return null;
  }
}

/**
 * Index `decisionId -> texte` d'UNE forme de dossier marqué (corpus ou
 * téléchargement) à travers plusieurs dossiers : en cas de doublon
 * d'identifiant entre deux dossiers de même forme, le plus récent gagne
 * (`folders` est déjà trié du plus récent au plus ancien).
 */
function mergeFoldersOfKind(folders, kind) {
  const merged = new Map();
  for (const { folder, kind: folderKind } of folders) {
    if (folderKind !== kind) continue;
    for (const [id, texte] of loadDecisionIndex(folder)) {
      if (!merged.has(id)) merged.set(id, texte);
    }
  }
  return merged;
}

/** Dossier du cache `consulter_decision` tenu par `decision-cache.mjs`. */
function decisionsCacheDir() {
  return path.join(os.homedir(), '.piecemaker', 'decisions');
}

/**
 * Index `decisionId -> texte` du cache `consulter_decision`
 * (`~/.piecemaker/decisions/<id>.json`, un fichier par décision). Renvoie
 * toujours une Map, vide si le dossier n'existe pas ou est illisible : ne
 * lève jamais.
 */
function loadDecisionCacheIndex() {
  const index = new Map();
  const dir = decisionsCacheDir();

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return index;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    let record;
    try {
      record = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
    } catch {
      continue; // fichier de cache corrompu : ignoré silencieusement.
    }
    if (!record || typeof record !== 'object') continue;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) continue;
    const texte = typeof record.texte === 'string' ? record.texte : '';
    index.set(id, texte);
  }
  return index;
}

/**
 * Fusionne les trois sources pour un jeu de racines donné : dossiers corpus,
 * cache `consulter_decision`, dossiers de téléchargement. Pour un même
 * identifiant, le texte le plus long disponible l'emporte ; à longueur égale,
 * la priorité va au corpus, puis au cache, puis au téléchargement.
 */
function buildDecisionIndex(roots) {
  const folders = findMarkedFolders(roots)
    .map((folder) => ({ folder, mtimeMs: markerMtimeMs(folder), kind: markerKind(folder) }))
    // Le plus récent d'abord, pour qu'un doublon d'identifiant au sein d'une
    // même forme retienne le dossier le plus récent.
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const corpusIndex = mergeFoldersOfKind(folders, 'legifrance-research');
  const cacheIndex = loadDecisionCacheIndex();
  const downloadIndex = mergeFoldersOfKind(folders, 'legifrance-results');

  const ids = new Set([...corpusIndex.keys(), ...cacheIndex.keys(), ...downloadIndex.keys()]);
  const merged = new Map();
  for (const id of ids) {
    const candidates = [
      { texte: corpusIndex.get(id), priority: 0 },
      { texte: cacheIndex.get(id), priority: 1 },
      { texte: downloadIndex.get(id), priority: 2 },
    ].filter((c) => typeof c.texte === 'string' && c.texte.length > 0);
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.texte.length - a.texte.length || a.priority - b.priority);
    merged.set(id, candidates[0].texte);
  }
  return merged;
}

/**
 * Fabrique un résolveur `decisionId -> Promise<string>` conforme à la
 * signature `getDecisionText` attendue par `verifyCitations` /
 * `verifyCaseCitationAnnotation`. `roots` est typiquement `[cwd]`. L'index
 * est construit une seule fois par process pour un jeu de racines donné,
 * puis réutilisé. Ne lève jamais : identifiant inconnu ou racines
 * inexploitables renvoient `''`.
 */
function createDecisionTextResolver(roots) {
  const key = cacheKeyForRoots(roots);
  return async function resolveDecisionText(decisionId) {
    try {
      const id = typeof decisionId === 'string' ? decisionId.trim() : '';
      if (!id) return '';

      let index = decisionIndexCache.get(key);
      if (!index) {
        index = buildDecisionIndex(roots);
        decisionIndexCache.set(key, index);
      }
      return index.get(id) ?? '';
    } catch {
      return '';
    }
  };
}

// ---------------------------------------------------------------------------
// createDocumentTextResolver — frontière stricte à caseRoot, .md uniquement
// ---------------------------------------------------------------------------

/** `true` si `candidate` (chemin absolu) est strictement sous `root`. */
function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === '') return false; // la racine elle-même n'est pas un fichier
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function readMarkdownFile(candidate) {
  if (path.extname(candidate).toLowerCase() !== '.md') return '';
  try {
    if (!fs.statSync(candidate).isFile()) return '';
  } catch {
    return '';
  }
  try {
    return fs.readFileSync(candidate, 'utf8');
  } catch {
    return '';
  }
}

function resolveDocumentTextFromCandidate(candidate, root, config) {
  if (!withinRoot(root, candidate)) return '';

  const direct = readMarkdownFile(candidate);
  if (direct) return direct;

  let counterpart;
  try {
    counterpart = structuredMarkdownCounterpart(candidate, root, config);
  } catch {
    counterpart = null;
  }
  if (!counterpart || !counterpart.exists || typeof counterpart.path !== 'string') return '';

  let counterpartAbsolute;
  try {
    counterpartAbsolute = path.resolve(counterpart.path);
  } catch {
    return '';
  }
  if (!withinRoot(root, counterpartAbsolute)) return '';
  return readMarkdownFile(counterpartAbsolute);
}

/**
 * Fabrique un résolveur `docId -> Promise<string>` conforme à la signature
 * `getSourceText` attendue par `verifyCitations` /
 * `verifyDocumentCitationAnnotation`. `docId` est traité comme un chemin :
 * absolu, ou relatif à `caseRoot` puis, à défaut, au répertoire courant.
 * Refuse (renvoie `''`) tout chemin hors de `caseRoot` et tout fichier dont
 * l'extension n'est pas `.md` — même frontière que `protect-originals.mjs`.
 * Ne lève jamais.
 */
function createDocumentTextResolver(caseRoot, config = {}) {
  return async function resolveDocumentText(docId) {
    try {
      if (typeof docId !== 'string' || !docId.trim()) return '';
      if (typeof caseRoot !== 'string' || !caseRoot.trim()) return '';

      const root = path.resolve(caseRoot);
      const requested = docId.trim();

      const candidates = [];
      if (path.isAbsolute(requested)) {
        candidates.push(path.resolve(requested));
      } else {
        candidates.push(path.resolve(root, requested));
        const viaCwd = path.resolve(process.cwd(), requested);
        if (!candidates.includes(viaCwd)) candidates.push(viaCwd);
      }

      for (const candidate of candidates) {
        const text = resolveDocumentTextFromCandidate(candidate, root, config);
        if (text) return text;
      }
      return '';
    } catch {
      return '';
    }
  };
}

module.exports = {
  findMarkedFolders,
  loadDecisionIndex,
  createDecisionTextResolver,
  createDocumentTextResolver,
};
