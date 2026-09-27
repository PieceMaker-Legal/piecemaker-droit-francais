/** Arborescence métier partagée par le serveur et les hooks. */
const fs = require('node:fs');
const path = require('node:path');

const CASE_FOLDER_STRUCTURE_KEY = 'caseFolderStructure';
const CASE_FOLDER_STRUCTURE_VERSION = 1;
const CASE_FOLDER_STRUCTURE_RELATIVE = '.piecemaker/case-folder-structure.json';

const DEFAULT_CASE_FOLDER_STRUCTURE = Object.freeze({
  correspondence: '01_CORRESPONDANCE',
  correspondenceClient: '01_Client',
  correspondenceOpposingCounsel: '02_Avocats_adverses',
  correspondenceThirdParties: '03_Tiers',
  correspondenceMarkdown: '00 - Emails convertis Md',
  dataRoom: '02_DATA_ROOM',
  dataRoomMarkdown: '00 - Pièces converties Md',
  drafts: '03_PROJETS',
  notesAndResearch: '04_NOTES_ET_RECHERCHES',
  procedure: '05_PROCEDURE',
});

const CASE_FOLDER_KEYS = Object.freeze(Object.keys(DEFAULT_CASE_FOLDER_STRUCTURE));
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function validateCaseFolderName(value, key = '') {
  const name = String(value ?? '').trim();
  if (!name || name.length > 120 || name === '.' || name === '..'
      || /[\\/\x00-\x1f\x7f<>:"|?*]/.test(name)
      || /[. ]$/.test(name) || WINDOWS_RESERVED_NAMES.test(name)) {
    const suffix = key ? ` (${key})` : '';
    throw new Error(`Nom de dossier invalide${suffix}.`);
  }
  return name;
}

function comparableName(value) {
  return String(value).normalize('NFKD').toLocaleLowerCase('fr');
}

function ensureUniqueSiblingNames(structure, keys, parentLabel) {
  const names = new Set();
  for (const key of keys) {
    const comparable = comparableName(structure[key]);
    if (names.has(comparable)) {
      throw new Error(`Deux dossiers de « ${parentLabel} » ne peuvent pas porter le même nom.`);
    }
    names.add(comparable);
  }
}

/**
 * Fusionne une configuration partielle avec les noms standards, puis valide
 * chaque segment. Les valeurs ne sont jamais interprétées comme des chemins :
 * un nom personnalisé reste obligatoirement un unique dossier.
 */
function normalizeCaseFolderStructure(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const structure = {};
  for (const key of CASE_FOLDER_KEYS) {
    structure[key] = validateCaseFolderName(
      source[key] === undefined ? DEFAULT_CASE_FOLDER_STRUCTURE[key] : source[key],
      key,
    );
  }

  ensureUniqueSiblingNames(structure, [
    'correspondence',
    'dataRoom',
    'drafts',
    'notesAndResearch',
    'procedure',
  ], 'la racine');
  ensureUniqueSiblingNames(structure, [
    'correspondenceClient',
    'correspondenceOpposingCounsel',
    'correspondenceThirdParties',
    'correspondenceMarkdown',
  ], structure.correspondence);

  return structure;
}

function configuredCaseFolderStructure(config = {}) {
  return normalizeCaseFolderStructure(config?.[CASE_FOLDER_STRUCTURE_KEY]);
}

function caseFolderStructureFile(caseRoot) {
  return path.join(caseRoot, ...CASE_FOLDER_STRUCTURE_RELATIVE.split('/'));
}

function readStructureManifest(caseRoot) {
  const file = caseFolderStructureFile(caseRoot);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const source = raw?.structure || raw?.names;
    return {
      file,
      exists: true,
      version: Number(raw?.version) || CASE_FOLDER_STRUCTURE_VERSION,
      structure: normalizeCaseFolderStructure(source),
    };
  } catch {
    return { file, exists: false, version: CASE_FOLDER_STRUCTURE_VERSION, structure: null };
  }
}

/**
 * Seuls les anciens dossiers portent encore un manifeste d'arborescence : il
 * continue de router leur Markdown. Sans manifeste, le dossier n'est pas géré.
 */
function readCaseFolderStructure(caseRoot, config = {}) {
  const manifest = readStructureManifest(caseRoot);
  return {
    ...manifest,
    structure: manifest.structure || configuredCaseFolderStructure(config),
  };
}

function relativeSegments(relativePath) {
  const value = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!value || value.startsWith('/') || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return [];
  }
  return value.split('/');
}

function sameFolderName(first, second) {
  return comparableName(first) === comparableName(second);
}

/**
 * Classe un chemin par rapport à l'arborescence figée du dossier. `businessSource`
 * désigne une pièce originale de Correspondance ou de Data Room ; les deux
 * sous-dossiers Markdown sont au contraire des sorties générées.
 */
function classifyRelativeCaseFolderPath(relativePath, structure, { managed = true } = {}) {
  const segments = relativeSegments(relativePath);
  const first = segments[0] || '';
  const second = segments[1] || '';
  let area = 'other';
  let generated = false;
  let outputRelative = null;

  if (sameFolderName(first, structure.correspondence)) {
    area = 'correspondence';
    generated = sameFolderName(second, structure.correspondenceMarkdown);
    outputRelative = path.join(structure.correspondence, structure.correspondenceMarkdown);
  } else if (sameFolderName(first, structure.dataRoom)) {
    area = 'dataRoom';
    generated = sameFolderName(second, structure.dataRoomMarkdown);
    outputRelative = path.join(structure.dataRoom, structure.dataRoomMarkdown);
  }

  return {
    area,
    managed,
    generated,
    businessSource: ['correspondence', 'dataRoom'].includes(area) && !generated,
    outputRelative: outputRelative ? outputRelative.split(path.sep).join('/') : null,
  };
}

function classifyCaseFolderPath(caseRoot, relativePath, config = {}) {
  const snapshot = readCaseFolderStructure(caseRoot, config);
  return classifyRelativeCaseFolderPath(relativePath, snapshot.structure, { managed: snapshot.exists });
}

function isCaseGeneratedPath(caseRoot, relativePath, config = {}) {
  return classifyCaseFolderPath(caseRoot, relativePath, config).generated;
}

/** Répertoire métier où la conversion d'une pièce structurée doit écrire. */
function caseConversionOutputDirectory(caseRoot, relativePath, config = {}) {
  const info = classifyCaseFolderPath(caseRoot, relativePath, config);
  if (!info.managed || !info.businessSource || !info.outputRelative) return null;
  return path.join(caseRoot, ...info.outputRelative.split('/'));
}

/**
 * Contrepartie Markdown attendue dans Correspondance/Data Room. Retourne `null`
 * pour un dossier legacy ou un fichier hors de ces deux zones.
 */
function structuredMarkdownCounterpart(absolutePath, caseRoot, config = {}) {
  const relative = path.relative(path.resolve(caseRoot), path.resolve(absolutePath)).split(path.sep).join('/');
  if (!relative || relative.startsWith('../')) return null;
  const output = caseConversionOutputDirectory(caseRoot, relative, config);
  if (!output) return null;
  const stem = path.basename(absolutePath, path.extname(absolutePath));
  const expected = path.join(output, `${stem}.md`);
  if (fs.existsSync(expected)) return { path: expected, exists: true };
  const key = comparableName(stem).replace(/[\s_-]+/g, ' ').trim();
  try {
    for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue;
      const candidate = comparableName(path.basename(entry.name, path.extname(entry.name)))
        .replace(/[\s_-]+/g, ' ').trim();
      if (candidate === key) return { path: path.join(output, entry.name), exists: true };
    }
  } catch {
    // Le sous-dossier sera créé par `ensureCaseFolderStructure` ou le pipeline.
  }
  return { path: expected, exists: false };
}

module.exports = {
  classifyRelativeCaseFolderPath,
  readCaseFolderStructure,
  structuredMarkdownCounterpart,
};
