/**
 * Conversion Markdown et pipeline d'anonymisation des pièces originales d'un
 * dossier juridique, pilotés depuis l'administration.
 *
 * Les originaux ne sortent jamais du dossier, et le pipeline porte sur toutes
 * les pièces du dossier, sans restriction de zone. Le Markdown d'une pièce de
 * `01_CORRESPONDANCE` ou `02_DATA_ROOM` est rangé dans le sous-dossier de
 * conversion métier correspondant ; celui d'une pièce hors de ces deux zones
 * rejoint le sous-dossier de travail générique. Le mapping canonique reste
 * dans `Fichiers convertis PieceMaker/` et l'état technique dans
 * `.piecemaker/anonymization-state.json`. Seules les lignes `PROGRESS:` et un
 * extrait d'erreur sont conservés dans le journal d'un travail : la sortie
 * brute des scripts peut contenir du texte de pièce, qui ne doit jamais
 * remonter dans l'interface.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  ensureProcessTreeStopped,
  terminateProcessTree,
} = require('./process-group.cjs');

const {
  originalFilesOverview,
  safeCaseFiles,
} = require('../piecemaker-plugin/scripts/lib/commits.cjs');
const { documentKey } = require('../piecemaker-plugin/scripts/lib/protection.cjs');
const {
  classifyRelativeCaseFolderPath,
  readCaseFolderStructure,
} = require('./case-folder-structure.cjs');
const { markFilesAnonymized } = require('../piecemaker-plugin/scripts/lib/anonymization-state.cjs');
// Le mapping vit dans le plugin : c'est le seul des trois consommateurs (hooks,
// pipeline, routeur du task pane) qui soit distribué seul.
const {
  caseMappingFile,
  normalizeMappingDocument,
  readCaseMapping,
  readJsonFile,
  sortedMapping,
} = require('../piecemaker-plugin/scripts/lib/mapping.cjs');
// Vocabulaire des sigles de sociétés (SA_1, SARL_1, PERS_MORALE_1…), miroir de
// `_LEGAL_FORMS` (scan_utils.py) — sert à classer un code déjà attribué.
const { isSocieteCode, societeCounterKey, detectCompanySigle, LEGAL_FORM_TOKENS } = require('./legal-forms.cjs');
// À chaque enregistrement d'un mapping de dossier, le mapping central global est
// reconstruit et dé-conflicté : c'est lui que le hook central applique à toute
// lecture, dossier ou non. `syncCentralMapping` ne jette jamais — un central qui
// échoue ne doit pas faire échouer la sauvegarde du dossier.
const { syncCentralMapping } = require('../piecemaker-plugin/scripts/lib/central-mapping.cjs');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const PIECEMAKER_HOME = path.join(os.homedir(), '.piecemaker');
const configuredPythonPath = () => {
  try {
    const { pythonPath } = JSON.parse(fs.readFileSync(path.join(PIECEMAKER_HOME, 'config.json'), 'utf8'));
    return pythonPath && fs.existsSync(pythonPath) ? pythonPath : null;
  } catch {
    return null;
  }
};
const PYTHON = () => process.env.PYTHON_PATH || configuredPythonPath() || 'python3';
const MAX_LOG_LINES = 200;
const MAX_ERROR_LINES = 12;

const GIB = 1024 ** 3;
/**
 * Contrôle d'admission des traitements — pensé pour ne jamais saturer la machine
 * de l'utilisateur (sa priorité explicite). Deux contraintes :
 *  1. exclusivité GLiNER : au plus un `anonymize` à la fois, quel que soit le
 *     dossier (deux workers chargeraient chacun ~400 Mo de poids et figeraient
 *     l'ordinateur) ;
 *  2. budget RAM : les conversions peuvent tourner en parallèle tant que la somme
 *     de leurs réservations reste sous ~la moitié de la RAM.
 * Tout est réglable par variable d'environnement, ce qui rend aussi les tests
 * déterministes sans dépendre de la RAM réelle.
 */
const RAM_BUDGET_BYTES = () => Number(process.env.PIECEMAKER_RAM_BUDGET_BYTES) || Math.floor(os.totalmem() * 0.5);
const JOB_RESERVE_BYTES = (action) => {
  if (action === 'anonymize') return Number(process.env.PIECEMAKER_ANONYMIZE_JOB_BYTES) || 3 * GIB;
  return Number(process.env.PIECEMAKER_CONVERT_JOB_BYTES) || 2 * GIB;
};
/** Priorité CPU (nice) des process de traitement : cède la main dès que l'utilisateur travaille. */
const JOB_NICE = () => {
  const value = Number(process.env.PIECEMAKER_JOB_NICE);
  return Number.isFinite(value) ? value : 10;
};
/** Threads torch du scanner : abaissé de 6 à 4 pour laisser des cœurs libres (le worker lit cette variable). */
const JOB_TORCH_THREADS = () => process.env.PIECEMAKER_TORCH_THREADS || '4';
const JOB_TIMEOUT_MS = () => {
  const value = Number(process.env.PIECEMAKER_ORIGINALS_JOB_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 60 * 60 * 1000;
};
const PROCESS_TERMINATION_GRACE_MS = () => {
  const value = Number(process.env.PIECEMAKER_PROCESS_GROUP_GRACE_MS);
  return Number.isFinite(value) && value > 0 ? value : 2_000;
};

/** Les pièces d'un dossier listées dans l'administration : tout sauf le Markdown. */
async function listOriginals(caseRoot) {
  const originals = await originalFilesOverview(caseRoot);
  const snapshot = readCaseFolderStructure(caseRoot);
  return originals
    .map((file) => ({
      file,
      info: classifyRelativeCaseFolderPath(file.path, snapshot.structure, { managed: snapshot.exists }),
    }))
    // Les images et autres dérivés produits avec le Markdown ne redeviennent
    // jamais des pièces originales dans l'administration.
    .filter(({ file, info }) => file.extension !== '.md' && !info.generated)
    .map(({ file, info }) => ({
      ...file,
      businessArea: info.area,
    }));
}

function caseMappingPayload(document) {
  const normalized = normalizeMappingDocument(document);
  return {
    mapping: sortedMapping(normalized.mapping),
    reverse_mapping: normalized.reverse_mapping,
    ...(Object.keys(normalized.extracted_data).length ? { extracted_data: normalized.extracted_data } : {}),
    ...(normalized.ignored.length ? { ignored: normalized.ignored } : {}),
    informations_dossier: normalized.informations_dossier,
  };
}

function writeCaseMapping(caseRoot, document) {
  const file = caseMappingFile(caseRoot);
  const payload = caseMappingPayload(document);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.piecemaker-${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  // Une fois le fichier canonique écrit avec succès, tous les autres mappings
  // sont supprimés : les legacy (`mapping_<id>.json`) comme un `mapping_default.json`
  // resté à la racine par une version antérieure — c'est la migration. La
  // comparaison porte sur le chemin complet, sinon un `mapping_default.json`
  // racine passerait pour le fichier canonique (même basename) et survivrait.
  // `readCaseMapping` les a tous fusionnés au préalable ; aucune entité n'est perdue.
  for (const dir of new Set([caseRoot, path.dirname(file)])) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/^mapping.*\.json$/i.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (full === file) continue;
      fs.unlinkSync(full);
    }
  }
  // Le mapping central reflète désormais ce dossier. Best-effort et jamais bloquant.
  try { syncCentralMapping(); } catch { /* le central ne doit pas bloquer une sauvegarde */ }
  return { file, exists: true, ignored: payload.ignored || [], ...payload };
}

/**
 * Enregistre un mapping édité à la main. Une entrée supprimée rejoint
 * `ignored` : c'est ce qui empêche un faux positif écarté par le juriste
 * d'être réintroduit par le scan suivant, que `rebuildCaseMapping` relit.
 */
function saveCaseMapping(caseRoot, document) {
  const current = readCaseMapping(caseRoot);
  // L'éditeur n'envoie que `mapping` et `reverse_mapping` : `extracted_data`
  // est repris du fichier, sinon un simple enregistrement perdrait les variants.
  const next = normalizeMappingDocument({
    extracted_data: current.extracted_data,
    informations_dossier: current.informations_dossier,
    ...document,
  });
  const removed = Object.keys(current.mapping).filter((entity) => !next.mapping[entity]);
  const ignored = [...new Set([...current.ignored, ...removed])].filter((entity) => !next.mapping[entity]);
  return writeCaseMapping(caseRoot, { ...next, ignored });
}

function codePrefix(entityType) {
  return String(entityType || 'ENTITE')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'ENTITE';
}

// Vocabulaire de codes et regroupement des variantes : mêmes règles que
// `convert_to_anonymization_format` et `consolidate_duplicate_entities` dans
// `scripts/convert_and_scan_pipeline.py`. Les deux chemins écrivent le même
// fichier de mapping — s'ils codaient différemment, une reconstruction depuis
// l'administration dédoublerait les entités déjà codées par le CLI.

const ENTITY_CATEGORIES = {
  PERSON: 'personnes_physiques',
  ORGANIZATION: 'societes',
  LOCATION: 'adresses',
  EMAIL: 'autres',
  PHONE: 'autres',
  CREDIT_CARD: 'autres',
  IBAN: 'autres',
  IP_ADDRESS: 'autres',
  URL: 'autres',
};

function entityCategory(entityType) {
  const type = String(entityType || '').toUpperCase();
  return ENTITY_CATEGORIES[type] || (type.startsWith('ORGANIZATION_') ? 'societes' : 'autres');
}

/** Catégorie d'un code déjà attribué — sert à repartir des bons compteurs. */
function codeCategory(code) {
  if (code.startsWith('SIREN_')) return 'siren';
  if (code.startsWith('ADRESSE_') || code.startsWith('LIEU_NAISSANCE_')) return 'adresses';
  if (code.includes('PERSONNE_PHYSIQUE_') || code.startsWith('DIRIGEANT_') || code.startsWith('AVOCAT_')) return 'personnes_physiques';
  // Sociétés : repli/legacy (…MORALE…, SOCIETE_…) et codes à sigle (SA_1, GMBH_2).
  // Testé après les familles distinctives, qui ne portent aucun sigle.
  if (isSocieteCode(code)) return 'societes';
  return 'autres';
}

/** Clé de compteur société (le sigle) déduite du type d'entité scanné. */
function societeCodeKey(entityType) {
  const type = String(entityType || '').toUpperCase();
  return type.startsWith('ORGANIZATION_')
    ? (codePrefix(type.slice('ORGANIZATION_'.length)) || 'PERS_MORALE')
    : 'PERS_MORALE';
}

function entityCode(entityType, category, index) {
  const type = String(entityType || 'AUTRE').toUpperCase();
  // Sociétés : sigle en préfixe, sans zéro (SA_1, SARL_1, PERS_MORALE_1), compteur
  // par sigle. Les autres familles gardent leur padding _01.
  if (category === 'societes') return `${societeCodeKey(entityType)}_${index}`;
  const number = String(index).padStart(2, '0');
  if (category === 'personnes_physiques') return `PERSONNE_PHYSIQUE_${number}`;
  if (category === 'adresses') return `ADRESSE_${number}`;
  return `${codePrefix(type)}_${number}`;
}

/** Forme comparable d'un nom : sans accents, sans civilité, en minuscules. */
function normalizeEntityName(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(mr\.?|mrs\.?|ms\.?|dr\.?|prof\.?|m\.|mme\.?|mlle\.?|maitre)\s*/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Deux écritures d'une même personne : « M. Dupont » et « Jean Dupont ». */
function areNamesSimilar(first, second) {
  if (!first || !second) return false;
  if (first === second) return true;
  if (Math.min(first.length, second.length) >= 3 && (first.includes(second) || second.includes(first))) return true;
  const tokens = [new Set(first.split(' ')), new Set(second.split(' '))];
  const [shorter, longer] = tokens[0].size <= tokens[1].size ? tokens : [tokens[1], tokens[0]];
  return shorter.size > 0 && [...shorter].every((token) => longer.has(token));
}

const CIVILITY_PREFIX = /^(?:(?:m|mr|mrs|ms|mme|mlle|dr|pr|prof|ma[iî]tre)\.\s*|(?:mr|mrs|ms|mme|mlle|dr|pr|prof|ma[iî]tre)\s+)/i;

function withoutCivility(text) {
  return String(text || '').replace(CIVILITY_PREFIX, '').trim();
}

function expandCivilityVariants(texts) {
  const expanded = [];
  for (const text of texts) {
    expanded.push(text);
    const bare = withoutCivility(text);
    if (bare && bare !== text) expanded.push(bare);
  }
  return [...new Set(expanded)];
}

function companyIdentity(text) {
  const tokens = normalizeEntityName(text)
    .split(/\s+/)
    .map((token) => token.replace(/[.,'’&"()]/g, ''))
    .filter(Boolean);
  const base = tokens.filter((token) => !LEGAL_FORM_TOKENS.has(token.toUpperCase())).join(' ');
  return { base, sigle: detectCompanySigle(text) };
}

function areCompaniesSame(first, second) {
  if (!first.base || !second.base) return false;
  if (first.base !== second.base) return false;
  return !first.sigle || !second.sigle || first.sigle === second.sigle;
}

function groupSimilarNames(texts) {
  const groups = [];
  for (const text of texts) {
    const normalized = normalizeEntityName(text);
    const group = groups.find((candidate) => candidate.normalized.some((member) => areNamesSimilar(normalized, member)));
    if (group) {
      group.texts.push(text);
      group.normalized.push(normalized);
    } else {
      groups.push({ texts: [text], normalized: [normalized] });
    }
  }
  return groups.map((group) => group.texts);
}

function groupSameCompanies(texts) {
  const groups = [];
  for (const text of texts) {
    const identity = companyIdentity(text);
    const group = groups.find((candidate) => candidate.identities.some((member) => areCompaniesSame(identity, member)));
    if (group) {
      group.texts.push(text);
      group.identities.push(identity);
    } else {
      groups.push({ texts: [text], identities: [identity] });
    }
  }
  return groups.map((group) => group.texts);
}

function groupEntityHits(hits, category) {
  const texts = [...new Set(hits.map((hit) => String(hit?.text || '').trim()).filter(Boolean))];
  if (category === 'personnes_physiques') return groupSimilarNames(expandCivilityVariants(texts));
  if (category === 'societes') return groupSameCompanies(texts);
  return texts.map((text) => [text]);
}

/**
 * Migre les anciens `*_sensitive_map.json` du dossier dans son mapping.
 * Une entrée déjà présente n'est jamais réécrite : un faux positif retiré à la
 * main ne doit pas revenir au scan suivant, et un code ne doit jamais servir
 * deux fois. Les écritures multiples d'une même personne rejoignent le code
 * déjà attribué au lieu d'en obtenir un second.
 */
async function rebuildCaseMapping(caseRoot) {
  const current = readCaseMapping(caseRoot);
  const mapping = { ...current.mapping };
  const ignored = new Set(current.ignored);
  const reverse = Object.fromEntries(Object.entries(current.reverse_mapping).map(([code, list]) => [code, [...list]]));
  const extracted = Object.fromEntries(
    Object.entries(current.extracted_data).map(([category, codes]) => [category, { ...codes }])
  );

  // Compteurs amorcés sur les codes déjà attribués. Les sociétés comptent par
  // sigle : la clé `societes:<sigle>` (SA, SARL, PERS_MORALE…) sépare les suites,
  // pour que la 1re SA soit SA_1 et la 1re SARL SARL_1 indépendamment.
  const counters = new Map();
  for (const code of new Set(Object.values(mapping))) {
    const match = /_(\d+)$/.exec(code);
    if (!match) continue;
    const category = codeCategory(code);
    const key = category === 'societes' ? `societes:${societeCounterKey(code)}` : category;
    counters.set(key, Math.max(counters.get(key) || 0, Number(match[1])));
  }

  // Index des noms déjà codés : une variante détectée plus tard rejoint son
  // code d'origine plutôt que d'en créer un nouveau.
  const coded = Object.entries(mapping).map(([entity, code]) => ({
    normalized: normalizeEntityName(entity),
    identity: companyIdentity(entity),
    category: codeCategory(code),
    code,
  }));

  let added = 0;
  for (const relative of await safeCaseFiles(caseRoot)) {
    if (!relative.toLowerCase().endsWith('_sensitive_map.json')) continue;
    const payload = readJsonFile(path.join(caseRoot, ...relative.split('/')), null);
    const entities = payload && typeof payload.entities === 'object' ? payload.entities : {};
    for (const [entityType, hits] of Object.entries(entities)) {
      if (!Array.isArray(hits)) continue;
      const category = entityCategory(entityType);
      for (const group of groupEntityHits(hits, category)) {
        const texts = group.filter((text) => !ignored.has(text));
        if (!texts.length) continue;

        let code = texts.map((text) => mapping[text]).find(Boolean);
        if (!code && category === 'personnes_physiques') {
          const normalized = texts.map(normalizeEntityName);
          code = coded.find((entry) => entry.category === category
            && normalized.some((name) => areNamesSimilar(name, entry.normalized)))?.code;
        }
        if (!code && category === 'societes') {
          const identities = texts.map(companyIdentity);
          code = coded.find((entry) => entry.category === category
            && identities.some((identity) => areCompaniesSame(identity, entry.identity)))?.code;
        }
        const isNewCode = !code;
        if (!code) {
          const key = category === 'societes' ? `societes:${societeCodeKey(entityType)}` : category;
          const index = (counters.get(key) || 0) + 1;
          counters.set(key, index);
          code = entityCode(entityType, category, index);
        }

        // Valeur principale : la plus longue écriture, comme côté Python.
        const principal = [...texts].sort((a, b) => b.length - a.length)[0];
        for (const text of texts) {
          if (mapping[text]) continue;
          mapping[text] = code;
          coded.push({ normalized: normalizeEntityName(text), identity: companyIdentity(text), category, code });
          added += 1;
        }
        if (isNewCode) reverse[code] = [principal];
        for (const text of texts) {
          if (!reverse[code].includes(text)) reverse[code].push(text);
        }

        if (!extracted[category]) extracted[category] = {};
        const entry = extracted[category][code] || { original: principal, code, variants: [] };
        entry.variants = [...new Set([...(entry.variants || []), ...texts])];
        extracted[category][code] = entry;
      }
    }
  }

  const saved = writeCaseMapping(caseRoot, {
    mapping,
    reverse_mapping: reverse,
    extracted_data: extracted,
    ignored: [...ignored],
    informations_dossier: current.informations_dossier,
  });
  const migratedScans = await migrateLegacySensitiveMaps(caseRoot);
  return { ...saved, added, total: Object.keys(saved.mapping).length, migratedScans };
}

/**
 * Transfère l'état porté par les anciens sensitive maps vers le manifeste sans
 * PII, puis retire ces artefacts devenus inutiles. Le mapping doit avoir été
 * reconstruit avant cet appel.
 */
async function migrateLegacySensitiveMaps(caseRoot) {
  const safeFiles = await safeCaseFiles(caseRoot);
  const legacy = safeFiles.filter((relative) => relative.toLowerCase().endsWith('_sensitive_map.json'));
  if (!legacy.length) return 0;

  const scannedKeys = new Set(legacy.map((relative) => {
    const basename = relative.split('/').at(-1) || '';
    return documentKey(basename).replace(/-sensitive-map$/, '');
  }));
  const originals = await listOriginals(caseRoot);
  const scannedOriginals = originals
    .filter((original) => scannedKeys.has(documentKey(original.name)))
    .map((original) => path.join(caseRoot, ...original.path.split('/')));
  if (scannedOriginals.length) markFilesAnonymized(caseRoot, scannedOriginals);

  for (const relative of legacy) fs.unlinkSync(path.join(caseRoot, ...relative.split('/')));
  return legacy.length;
}

// ── Travaux de conversion / anonymisation ──────────────────────────────────

function appendLog(job, line) {
  const text = String(line || '').trim();
  if (!text) return;
  job.log.push(text);
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

// ── Contrôle d'admission : sérialise GLiNER, plafonne les conversions par la RAM ─

/** Descripteurs de traitements admis mais pas encore lancés, du plus ancien au plus récent. */
const waiting = [];
let reservedBytes = 0;
let acceptingJobs = true;

/**
 * Traitements en cours, tous consommateurs confondus : l'exclusivité GLiNER
 * doit rester vraie quel que soit celui qui a lancé le traitement.
 */
const runningManaged = new Set();

function runningAnonymize() {
  for (const job of runningManaged) {
    if (job.action === 'anonymize') return true;
  }
  return false;
}

/**
 * Un job peut-il démarrer maintenant ? Exclusivité GLiNER pour `anonymize`, puis
 * budget RAM. Un job seul est toujours admis même s'il dépasse le budget, sinon
 * un traitement plus gros que la moitié de la RAM ne partirait jamais.
 */
function canAdmit(job) {
  if (job.action === 'anonymize' && runningAnonymize()) return false;
  if (reservedBytes > 0 && reservedBytes + job.reserveBytes > RAM_BUDGET_BYTES()) return false;
  return true;
}

/**
 * Admet les traitements en file qui rentrent désormais, du plus ancien au plus
 * récent.
 */
function pumpQueue() {
  if (!acceptingJobs) return;
  for (let index = 0; index < waiting.length; index += 1) {
    const descriptor = waiting[index];
    if (!canAdmit(descriptor.job)) continue;
    waiting.splice(index, 1);
    index -= 1;
    launchManagedJob(descriptor);
  }
}

/**
 * Lance le script Python et suit son avancement. Seules les lignes
 * `PROGRESS:PHASE:pct:courant:total` alimentent le journal ; le reste de la
 * sortie est ignoré (texte de pièce potentiel), à l'exception d'un extrait de
 * stderr conservé pour diagnostiquer un échec.
 *
 * `progressScale` reporte le pourcentage 0-100 de cet appel dans la part
 * `[offset, offset + weight]` du travail global : un appelant qui enchaîne
 * plusieurs appels garde ainsi une progression monotone plutôt qu'un
 * pourcentage qui repart de zéro à chaque appel.
 *
 * `convert_and_scan_pipeline.py` enchaîne lui-même CONVERT (markitdown) puis
 * SCAN/CHUNKS (GLiNER) au sein d'un même appel, chacun avec son propre 0-100 :
 * sans repère de sous-phase, le pourcentage retomberait à zéro au passage de
 * l'un à l'autre. Le poids du groupe est donc partagé entre les deux, GLiNER
 * (chargement du modèle puis analyse) dominant largement markitdown en durée.
 */
const CONVERT_SUBPHASE_SHARE = 0.25;

function cancellationError(job) {
  return new Error(
    job.cancelReason === 'timeout'
      ? 'Traitement interrompu après dépassement du délai maximal.'
      : 'Traitement interrompu.'
  );
}

function stopRunningJob(job, reason) {
  if (!job.cancelled) {
    job.cancelled = true;
    job.cancelReason = reason;
  }
  if (!job.processGroupId) return Promise.resolve();
  if (!job.stopPromise) {
    job.stopPromise = terminateProcessTree(job.processGroupId, {
      graceMs: PROCESS_TERMINATION_GRACE_MS(),
    });
  }
  return job.stopPromise;
}

async function verifyJobProcessTreeStopped(job, processGroupId = job.processGroupId) {
  if (!processGroupId) return;
  if (job.stopPromise) await job.stopPromise;
  await ensureProcessTreeStopped(processGroupId, {
    graceMs: PROCESS_TERMINATION_GRACE_MS(),
  });
}

function spawnTracked(job, script, args, progressScale = {}) {
  const offset = progressScale.offset || 0;
  const weight = progressScale.weight ?? 100;
  const convertWeight = weight * CONVERT_SUBPHASE_SHARE;
  const scanWeight = weight - convertWeight;
  return new Promise((resolve, reject) => {
    if (job.cancelled) {
      reject(cancellationError(job));
      return;
    }
    if (!fs.existsSync(script)) {
      reject(new Error(`Script introuvable : ${path.basename(script)}`));
      return;
    }
    const child = spawn(PYTHON(), [script, ...args], {
      cwd: SCRIPTS_DIR,
      // POSIX descendants inherit this dedicated process group. It lets the
      // host stop Python, GLiNER, MinerU and office converters as one unit.
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        // Le worker et MinerU, enfants de ce process, héritent de la variable.
        PIECEMAKER_TORCH_THREADS: JOB_TORCH_THREADS(),
      },
      windowsHide: true,
    });
    job.child = child;
    job.processGroupId = child.pid;
    job.stopPromise = null;
    // Basse priorité CPU : un scan long ne doit pas figer la machine. Les enfants
    // (worker GLiNER, MinerU) héritent du nice sous POSIX. Best-effort — un échec
    // (droits, plateforme) ne doit jamais empêcher le traitement.
    try {
      os.setPriority(child.pid, JOB_NICE());
    } catch {
      // priorité inchangée, sans conséquence sur le résultat
    }
    const errorLines = [];
    let stdoutRest = '';
    let stderrRest = '';

    const consumeStdout = (chunk) => {
      stdoutRest += chunk;
      const lines = stdoutRest.split(/\r?\n/);
      stdoutRest = lines.pop() || '';
      for (const line of lines) {
        const progress = /^PROGRESS:([A-Z]+):(\d+):(\d+):(\d+)/.exec(line.trim());
        if (!progress) continue;
        const [, marker, pct, current, total] = progress;
        // CONVERT : fichier par fichier. SCAN : fichier par fichier de la phase PII.
        // CHUNKS : progression *à l'intérieur* d'un scan (réémise par le pipeline
        // depuis le worker) — c'est elle qui fait vivre la barre pendant les longues
        // minutes d'un gros document, là où SCAN restait figé sur « 1/1 ».
        job.phase = marker === 'CONVERT' ? 'convert' : 'scan';
        const subPct = Math.min(100, Number(pct) || 0);
        job.percent = job.phase === 'convert'
          ? Math.min(100, offset + (subPct * convertWeight) / 100)
          : Math.min(100, offset + convertWeight + (subPct * scanWeight) / 100);
        job.processed = Number(current) || 0;
        job.total = Number(total) || job.total;
        const unit = marker === 'CHUNKS' ? ' segments' : '';
        appendLog(job, `${job.phase === 'scan' ? 'Analyse PII' : 'Conversion'} ${job.processed}/${job.total}${unit}`);
      }
    };
    const consumeStderr = (chunk) => {
      stderrRest += chunk;
      const lines = stderrRest.split(/\r?\n/);
      stderrRest = lines.pop() || '';
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        errorLines.push(text);
        if (errorLines.length > MAX_ERROR_LINES) errorLines.shift();
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', consumeStdout);
    child.stderr.on('data', consumeStderr);
    let settled = false;
    const finish = async (code, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      const processGroupId = job.processGroupId;
      try {
        await verifyJobProcessTreeStopped(job, processGroupId);
        if (spawnError) throw spawnError;
        if (job.cancelled) throw cancellationError(job);
        if (code !== 0) {
          const detail = errorLines.slice(-3).join(' · ');
          throw new Error(`${path.basename(script)} a échoué (${signal || `code ${code}`})${detail ? ` : ${detail}` : ''}`);
        }
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        if (job.child === child) job.child = null;
        if (job.processGroupId === processGroupId) job.processGroupId = null;
        job.stopPromise = null;
      }
    };

    // `exit` fires when the direct Python process ends. Waiting only for
    // `close` can hang forever when an orphan still owns an inherited pipe.
    child.once('error', (error) => void finish(null, null, error));
    child.once('exit', (code, signal) => void finish(code, signal));
  });
}

/**
 * Point d'entrée générique pour tout traitement devant passer par le même
 * contrôle d'admission que les pièces originales (exclusivité GLiNER, budget
 * RAM, file d'attente, nice, timeout, arrêt propre du groupe de process).
 *
 * Cette fonction ne connaît aucune notion de dossier juridique enregistré
 * (`legalCase`, mapping, commit) : elle sert les consommateurs qui ont leur
 * propre gestion du résultat (le
 * pipeline `knowledge`, dont le `projectId` n'est pas un dossier juridique du
 * registre) mais qui doivent néanmoins partager le même verrou GLiNER et le
 * même budget RAM que l'administration — sinon rien n'empêche deux scans
 * simultanés de charger chacun leur propre modèle et de figer la machine.
 *
 * Lance directement `script` avec `args` via `spawnTracked` (même parseur de
 * lignes `PROGRESS:`, même gestion du groupe de process, même priorité nice).
 * `onProgress`, si fourni, est appelé à chaque mise à jour de la progression
 * avec `{ phase, percent, processed, total }`.
 */
function runManagedPythonJob({ action, script, args, onProgress, signal } = {}) {
  if (!['convert', 'anonymize'].includes(action)) throw new Error('Action inconnue.');
  if (!acceptingJobs) throw new Error('Le serveur est en cours d’arrêt : aucun nouveau traitement ne peut démarrer.');
  const job = {
    action,
    cancelled: false,
    cancelReason: null,
    child: null,
    processGroupId: null,
    stopPromise: null,
    phase: 'convert',
    percent: 0,
    processed: 0,
    total: 0,
    log: [],
    reserveBytes: JOB_RESERVE_BYTES(action),
  };
  if (onProgress) {
    for (const key of ['phase', 'percent', 'processed', 'total']) {
      let value = job[key];
      Object.defineProperty(job, key, {
        get: () => value,
        set: (next) => {
          value = next;
          onProgress({ phase: job.phase, percent: job.percent, processed: job.processed, total: job.total });
        },
      });
    }
  }
  const abort = () => { void stopRunningJob(job, 'user-cancellation'); };
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  const run = () => spawnTracked(job, script, args);
  const descriptor = { job, run };
  const completion = new Promise((resolve, reject) => {
    descriptor.resolve = resolve;
    descriptor.reject = reject;
  });
  runningManaged.add(job);
  if (canAdmit(job)) {
    launchManagedJob(descriptor);
  } else {
    waiting.push(descriptor);
  }
  return completion.finally(() => {
    signal?.removeEventListener('abort', abort);
  });
}

/** Lancement d'un descripteur `runManagedPythonJob` (pas de `legalCase`/commit à gérer ici). */
function launchManagedJob(descriptor) {
  const { job, run, resolve, reject } = descriptor;
  reservedBytes += job.reserveBytes;
  const timeoutId = setTimeout(() => {
    void stopRunningJob(job, 'timeout');
  }, JOB_TIMEOUT_MS());
  (async () => {
    try {
      if (job.cancelled) throw cancellationError(job);
      const result = await run(job);
      if (job.cancelled) throw cancellationError(job);
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      clearTimeout(timeoutId);
      const processGroupId = job.processGroupId;
      try {
        await verifyJobProcessTreeStopped(job, processGroupId);
      } catch {
        // Best-effort : une erreur de nettoyage ne doit pas masquer le résultat déjà tranché ci-dessus.
      }
      job.child = null;
      job.processGroupId = null;
      job.stopPromise = null;
      runningManaged.delete(job);
      reservedBytes -= job.reserveBytes;
      pumpQueue();
    }
  })();
}

let stopAllPromise = null;

/**
 * Arrêt serveur : ferme l'admission, annule toute la file, tue chaque groupe
 * actif et attend le `finally` de chaque job avant de rendre la main.
 */
function stopOriginalsJobs() {
  if (stopAllPromise) return stopAllPromise;
  acceptingJobs = false;

  stopAllPromise = (async () => {
    for (const descriptor of waiting.splice(0)) {
      const { job } = descriptor;
      job.cancelled = true;
      job.cancelReason = 'server-shutdown';
      descriptor.reject(cancellationError(job));
    }

    const running = [...runningManaged];
    const groups = [...new Set(running.map((job) => job.processGroupId).filter(Boolean))];
    await Promise.allSettled(running.map((job) => stopRunningJob(job, 'server-shutdown')));

    // Contrôle défensif final, y compris si un enfant a fermé ses pipes avant
    // que son événement `exit` ait été traité par le suivi normal du job.
    await Promise.all(groups.map((processGroupId) => ensureProcessTreeStopped(processGroupId, {
      graceMs: PROCESS_TERMINATION_GRACE_MS(),
    })));
  })();
  return stopAllPromise;
}

module.exports = {
  groupEntityHits,
  // Point d'entrée partagé : tout consommateur d'un pipeline GLiNER/markitdown
  // (même hors dossier juridique enregistré, ex. `knowledge/pipeline.ts`) doit
  // passer par ici pour rester sous l'exclusivité GLiNER et le budget RAM.
  runManagedPythonJob,
  stopOriginalsJobs,
  // Ré-exportés pour les routes de l'administration : l'implémentation vit
  // désormais dans `piecemaker-plugin/scripts/lib/mapping.cjs`.
  caseMappingFile,
  listOriginals,
  readCaseMapping,
  rebuildCaseMapping,
  saveCaseMapping,
  writeCaseMapping,
};
