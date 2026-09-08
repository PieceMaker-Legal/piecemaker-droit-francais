/**
 * Dictionnaire d'anonymisation du proxy PII.
 *
 * Source unique : le mapping central écrit par `central-mapping.cjs` lors de
 * l'enregistrement d'un mapping de dossier. Il réunit tous les dossiers
 * enregistrés avec des codes dé-conflictés, ce qui est exactement ce qu'un
 * chokepoint réseau demande : un nom appartenant au dossier B doit rester
 * protégé même s'il est tapé dans une conversation ouverte sur le dossier A.
 * Un proxy par dossier ne saurait pas le faire.
 *
 * Le fichier contient des noms réels (mode 0600). Il n'est jamais servi tel
 * quel : `routes.cjs` n'en expose que ce dont l'interface a besoin pour
 * surligner, et seulement derrière l'authentification CloudCLI.
 *
 * Rechargement à chaud sur `mtime` : une conversion qui ré-écrit le mapping est
 * prise en compte sans redémarrer CloudCLI.
 */
const fs = require('node:fs');
const path = require('node:path');

const {
  applyMapping,
  buildEntityRegex,
  revertMapping,
  MIN_ENTITY_LENGTH,
} = require('../vendor/piecemaker-plugin/scripts/lib/substitution.cjs');

const CENTRAL_FILENAME = 'central-mapping.json';

/** Un dictionnaire vide se comporte comme un proxy transparent. */
const EMPTY = Object.freeze({
  version: 0,
  updatedAt: null,
  mapping: Object.freeze({}),
  reverse: Object.freeze({}),
  canonical: Object.freeze({}),
  displayNames: Object.freeze([]),
  displayAcronyms: Object.freeze([]),
  entityCount: 0,
  codeCount: 0,
  empty: true,
});

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Construit le dictionnaire exploitable à partir du document central.
 *
 * `canonical` est la projection code → orthographe principale, celle que
 * `revertMapping` rend à l'humain.
 *
 * `displayNames` et `displayAcronyms` sont ce que l'interface surligne. Ils
 * sortent des clés de `mapping`, c'est-à-dire des orthographes que
 * `applyMapping` code réellement — variantes secondaires comprises — et non de
 * `reverse_mapping`, qui ne porte que la forme principale. Une entité que le
 * moteur refuse de substituer (`buildEntityRegex` nul : ponctuation pure, deux
 * caractères non acronymiques) est écartée des deux listes : surligner ce qui
 * ne part pas codé serait un mensonge à l'écran.
 *
 * La séparation des deux listes reproduit la seule asymétrie du moteur : au-delà
 * de `MIN_ENTITY_LENGTH`, la casse est ignorée ; à deux caractères, l'acronyme
 * reste sensible à la casse, faute de quoi « US » emporterait le pronom « us ».
 */
function buildDictionary(document, stamp) {
  const mapping = plainObject(document?.mapping);
  const reverse = plainObject(document?.reverse_mapping);
  const canonical = {};
  for (const [code, variants] of Object.entries(reverse)) {
    const name = Array.isArray(variants) ? variants[0] : variants;
    if (typeof name === 'string' && name.trim()) canonical[code] = name;
  }

  const foldedNames = new Map();
  const acronyms = new Set();
  for (const entity of Object.keys(mapping)) {
    if (!buildEntityRegex(entity)) continue;
    const trimmed = entity.trim();
    if (trimmed.length < MIN_ENTITY_LENGTH) {
      acronyms.add(trimmed);
      continue;
    }
    const folded = trimmed.toLocaleLowerCase();
    if (!foldedNames.has(folded)) foldedNames.set(folded, trimmed);
  }
  const displayNames = Array.from(foldedNames.values());
  const displayAcronyms = Array.from(acronyms);
  const entityCount = Object.keys(mapping).length;
  const codeCount = Object.keys(canonical).length;
  return {
    version: stamp,
    updatedAt: typeof document?.updated_at === 'string' ? document.updated_at : null,
    mapping,
    reverse,
    canonical,
    displayNames,
    displayAcronyms,
    entityCount,
    codeCount,
    empty: entityCount === 0 && codeCount === 0,
  };
}

/**
 * Chargeur à cache : relit le fichier uniquement quand sa signature
 * (mtime + taille) change. `version` s'incrémente à chaque rechargement effectif,
 * ce qui sert de clé de cache aux consommateurs (client compris).
 */
function createDictionaryLoader({ homeDir }) {
  const file = path.join(homeDir, CENTRAL_FILENAME);
  let signature = null;
  let current = EMPTY;
  let generation = 0;

  function statSignature() {
    try {
      const stats = fs.statSync(file);
      return `${stats.mtimeMs}:${stats.size}`;
    } catch {
      return null;
    }
  }

  function load(force = false) {
    const next = statSignature();
    if (!force && next === signature) return current;
    signature = next;
    if (next === null) {
      current = EMPTY;
      return current;
    }
    const document = readJson(file);
    generation += 1;
    current = document ? buildDictionary(document, generation) : EMPTY;
    return current;
  }

  return {
    file,
    /** Le dictionnaire à jour, relu si le fichier a bougé. */
    get: () => load(false),
    /** Relecture inconditionnelle, pour le bouton « rafraîchir ». */
    refresh: () => load(true),
    exists: () => statSignature() !== null,
  };
}

/** Nom réel → code, sur tout ce qui part vers l'API. */
function anonymize(text, dictionary) {
  return dictionary.empty ? text : applyMapping(text, dictionary.mapping);
}

/** Code → nom réel, sur tout ce qui revient de l'API vers la machine. */
function deanonymize(text, dictionary) {
  return dictionary.empty ? text : revertMapping(text, dictionary.reverse);
}

module.exports = {
  CENTRAL_FILENAME,
  EMPTY_DICTIONARY: EMPTY,
  anonymize,
  buildDictionary,
  createDictionaryLoader,
  deanonymize,
};
