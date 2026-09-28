/**
 * Mapping d'anonymisation d'un dossier juridique — implémentation unique.
 *
 * Le pipeline admin (`websocket-server/originals-pipeline.cjs`), le serveur
 * Word, l'historique et les vues juridiques la partagent.
 *
 * Deux sens, jamais symétriques dans leur usage :
 *  - `applyMapping`  entité → code, sur tout ce que l'IA s'apprête à lire ;
 *  - `revertMapping` code → entité, sur tout ce que l'IA produit et qui
 *    atterrit chez un humain (fichier, message Telegram, libellé de commit).
 *
 * Les deux sont idempotents : réappliquer un mapping à un texte déjà codé ne
 * change rien, ce qui permet aux appelants de retraiter un texte sans risque.
 */
const fs = require('node:fs');
const path = require('node:path');

const { WORKSPACE_SUBDIR } = require('./protection.cjs');
const { locateProjectCase } = require('./case-folders.cjs');
const { isInstitutionalEntity } = require('./institutional-terms.cjs');
// Le moteur de substitution est extrait dans un module autonome : il est aussi
// requis par le proxy PII (`anonymizer/dictionary.cjs`). Une seule
// implémentation, ré-exportée ici pour les appelants historiques.
const {
  applyMapping,
  buildEntityRegex,
  byDescendingEntityLength,
  escapeRegex,
  escapeWithVariants,
  resolveMappedPath,
  revertMapping,
} = require('./substitution.cjs');

const CANONICAL_MAPPING_FILE = 'mapping_default.json';

// ───────────────────────────── Fichier de mapping ───────────────────────────

function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return fallback;
  }
}

/**
 * Tous les mappings présents, sous-dossier `WORKSPACE_SUBDIR` **et** racine
 * (lecture tolérante pendant la migration). Le fichier canonique du sous-dossier
 * passe en dernier : c'est lui qui gagne quand `readCaseMapping` fusionne, tandis
 * que les copies legacy (racine ou `mapping_<id>.json`) complètent la lecture.
 */
function existingMappingFiles(caseRoot) {
  const dirs = [
    { path: path.join(caseRoot, WORKSPACE_SUBDIR), inSubfolder: true },
    { path: caseRoot, inSubfolder: false },
  ];
  const found = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/^mapping.*\.json$/i.test(entry.name)) continue;
      found.push({
        full: path.join(dir.path, entry.name),
        name: entry.name,
        // Priorité de fusion croissante : legacy racine < canonique racine <
        // legacy sous-dossier < canonique sous-dossier (dernier, il l'emporte).
        rank: (dir.inSubfolder ? 2 : 0) + (entry.name === CANONICAL_MAPPING_FILE ? 1 : 0),
      });
    }
  }
  return found
    .sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name, 'fr'))
    .map((entry) => entry.full);
}

/**
 * Emplacement historique du mapping JSON d'un dossier, lu seulement : plus
 * aucun code ne l'écrit, le mapping vit en base.
 */
function caseMappingFile(caseRoot) {
  return path.join(caseRoot, WORKSPACE_SUBDIR, CANONICAL_MAPPING_FILE);
}

function normalizeMappingDocument(raw) {
  const document = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mapping = {};
  const reverse = {};
  const source = document.mapping && typeof document.mapping === 'object' ? document.mapping : {};
  // Les entités institutionnelles (juridictions, registres, publications
  // officielles…) sont écartées ici même, à la lecture : une entité bannie n'est
  // jamais substituée par les hooks. GLiNER continue de les détecter — on ne
  // débranche que le codage.
  for (const [entity, code] of Object.entries(source)) {
    const from = String(entity || '').trim();
    const to = String(code || '').trim();
    if (from && to && !isInstitutionalEntity(from)) mapping[from] = to;
  }
  const reverseSource = document.reverse_mapping && typeof document.reverse_mapping === 'object' ? document.reverse_mapping : {};
  for (const [code, value] of Object.entries(reverseSource)) {
    const key = String(code || '').trim();
    if (!key) continue;
    const values = (Array.isArray(value) ? value : [value])
      .map((item) => String(item || '').trim())
      .filter((item) => item && !isInstitutionalEntity(item));
    if (values.length) reverse[key] = [...new Set(values)];
  }
  // Un mapping écrit à la main peut n'avoir que le sens direct : on reconstruit
  // le sens inverse plutôt que de laisser un fichier inutilisable.
  for (const [entity, code] of Object.entries(mapping)) {
    if (!reverse[code]) reverse[code] = [entity];
    else if (!reverse[code].includes(entity)) reverse[code].push(entity);
  }
  return { mapping, reverse_mapping: reverse };
}

/** L'ordre d'écriture suit `byDescendingEntityLength`. */
function readCaseMapping(caseRoot) {
  const file = caseMappingFile(caseRoot);
  const sourceFiles = existingMappingFiles(caseRoot);
  if (!sourceFiles.length) {
    return { file, sourceFiles: [], exists: false, ...normalizeMappingDocument(null) };
  }

  // Tous les anciens mappings sont réunis en mémoire. Le canonique passe en
  // dernier et gagne donc si une même entité a été recodée.
  const mapping = {};
  const preferredVariants = {};
  const readableFiles = [];
  for (const sourceFile of sourceFiles) {
    const raw = readJsonFile(sourceFile, null);
    if (raw === null) continue;
    readableFiles.push(sourceFile);
    const document = normalizeMappingDocument(raw);
    Object.assign(mapping, document.mapping);
    for (const [code, variants] of Object.entries(document.reverse_mapping)) {
      preferredVariants[code] = [...new Set([...(preferredVariants[code] || []), ...variants])];
    }
  }

  const reverse_mapping = {};
  for (const [entity, code] of Object.entries(mapping)) {
    if (!reverse_mapping[code]) {
      const preferred = (preferredVariants[code] || []).filter((variant) => mapping[variant] === code);
      reverse_mapping[code] = [...preferred];
    }
    if (!reverse_mapping[code].includes(entity)) reverse_mapping[code].push(entity);
  }
  return {
    file,
    sourceFiles: readableFiles,
    exists: readableFiles.length > 0,
    ...normalizeMappingDocument({ mapping, reverse_mapping }),
  };
}

// La substitution (`applyMapping` / `revertMapping`) vit dans `substitution.cjs`
// et est importée en tête de fichier. Elle est ré-exportée ci-dessous pour les
// appelants historiques de `mapping.cjs`.

/** Resolve the mapping of the project folder containing the hint. */
function resolveProjectCaseMapping(hint) {
  const located = locateProjectCase(hint);
  if (!located) return null;
  const mapping = readCaseMapping(located.caseRoot);
  if (!mapping.exists) return null;
  return { ...located, ...mapping };
}

module.exports = {
  applyMapping,
  buildEntityRegex,
  byDescendingEntityLength,
  escapeWithVariants,
  readCaseMapping,
  resolveProjectCaseMapping,
  resolveMappedPath,
  revertMapping,
};
