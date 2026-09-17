/**
 * Dictionnaire d'anonymisation du proxy PII.
 *
 * Le proxy charge le dictionnaire depuis SQLite (`sqlite-dictionary.cjs`,
 * tables `piecemaker_mappings` / `piecemaker_nodes`). Ce module construit la
 * forme exploitable (`buildDictionary`) et applique la substitution.
 *
 * Un nom appartenant au dossier B doit rester protégé même s'il est tapé dans
 * une conversation ouverte sur le dossier A. Un proxy par dossier ne saurait
 * pas le faire.
 */
const {
  applyMapping,
  buildEntityRegex,
  revertMapping,
  MIN_ENTITY_LENGTH,
} = require('../vendor/piecemaker-plugin/scripts/lib/substitution.cjs');

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
      acronyms.add(trimmed.toUpperCase());
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

/** Nom réel → code, sur tout ce qui part vers l'API. */
function anonymize(text, dictionary) {
  return dictionary.empty ? text : applyMapping(text, dictionary.mapping);
}

/** Code → nom réel, sur tout ce qui revient de l'API vers la machine. */
function deanonymize(text, dictionary) {
  return dictionary.empty ? text : revertMapping(text, dictionary.reverse);
}

module.exports = {
  EMPTY_DICTIONARY: EMPTY,
  anonymize,
  buildDictionary,
  deanonymize,
};
