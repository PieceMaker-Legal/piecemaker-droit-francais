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
  unambiguous: Object.freeze({}),
  ambiguous: Object.freeze([]),
  codeProjects: Object.freeze(new Map()),
  retiredByProject: Object.freeze({}),
  reverse: Object.freeze({}),
  canonical: Object.freeze({}),
  displayNames: Object.freeze([]),
  displayAcronyms: Object.freeze([]),
  entityCount: 0,
  codeCount: 0,
  empty: true,
});

const MEMO_MIN_LENGTH = 256;
const MEMO_BUDGET = 16 * 1024 * 1024;
const memos = new WeakMap();
const projectReverses = new WeakMap();
const CODE_TOKEN = /(?<![\p{L}\p{N}_])[A-Z][A-Z0-9_]*_\d+(?![\p{L}\p{N}_])/gu;

function memoFor(dictionary) {
  let memo = memos.get(dictionary);
  if (!memo) {
    memo = { entries: new Map(), size: 0 };
    memos.set(dictionary, memo);
  }
  return memo;
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
 */
function buildDictionary(document, stamp) {
  const mapping = Object.freeze({ ...plainObject(document?.mapping) });
  const reverse = Object.freeze(Object.fromEntries(Object.entries(plainObject(document?.reverse_mapping))
    .map(([code, variants]) => [code, Array.isArray(variants) ? Object.freeze([...variants]) : variants])));
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
  const ambiguousCodes = plainObject(document?.ambiguous);
  const ambiguous = Object.freeze(Object.entries(ambiguousCodes)
    .filter(([variant, codes]) => Array.isArray(codes) && codes.length > 1 && mapping[variant] && buildEntityRegex(variant))
    .map(([variant, codes]) => Object.freeze({ variant, codes: Object.freeze([...codes]), regex: buildEntityRegex(variant) })));
  const unambiguous = Object.freeze(Object.fromEntries(Object.entries(mapping).filter(([variant]) => !Array.isArray(ambiguousCodes[variant]))));
  const codeProjects = new Map(Object.entries(plainObject(document?.code_projects)));
  const retiredByProject = Object.freeze(plainObject(document?.retired_by_project));
  const displayNames = Array.from(foldedNames.values());
  const displayAcronyms = Array.from(acronyms);
  const entityCount = Object.keys(mapping).length;
  const codeCount = Object.keys(canonical).length;
  return {
    version: stamp,
    updatedAt: typeof document?.updated_at === 'string' ? document.updated_at : null,
    mapping,
    unambiguous,
    ambiguous,
    codeProjects,
    retiredByProject,
    reverse,
    canonical,
    displayNames,
    displayAcronyms,
    entityCount,
    codeCount,
    empty: entityCount === 0 && codeCount === 0,
  };
}

function presentCodes(text) {
  const counts = new Map();
  for (const [code] of text.matchAll(CODE_TOKEN)) counts.set(code, (counts.get(code) || 0) + 1);
  return counts;
}

/**
 * Choisit, pour une requête entière, le code de chaque variante partagée par
 * plusieurs nœuds : celui du dossier de la session d'abord, puis celui du
 * dossier dont les autres noms et codes sont les plus présents dans la requête,
 * puis celui de la personne déjà citée, puis l'ordre du dictionnaire.
 */
function resolveContext(dictionary, { projectId = null, text = '' } = {}) {
  const context = { projectId: projectId || null, overrides: null, key: '' };
  if (!dictionary.ambiguous?.length || typeof text !== 'string' || !text) return context;
  const shared = dictionary.ambiguous.filter((entry) => {
    entry.regex.lastIndex = 0;
    return entry.regex.test(text);
  });
  if (!shared.length) return context;
  const counts = presentCodes(applyMapping(text, dictionary.unambiguous));
  const projectScores = new Map();
  for (const code of counts.keys()) {
    const project = dictionary.codeProjects.get(code);
    if (project) projectScores.set(project, (projectScores.get(project) || 0) + 1);
  }
  const rank = (code) => {
    const project = dictionary.codeProjects.get(code);
    return [project && project === context.projectId ? 1 : 0, projectScores.get(project) || 0, counts.get(code) || 0];
  };
  const overrides = new Map();
  for (const { variant, codes } of shared) {
    const best = codes.reduce((winner, code) => {
      const [a, b] = [rank(code), rank(winner)];
      return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0 ? code : winner;
    });
    if (best !== dictionary.mapping[variant]) overrides.set(variant, best);
  }
  if (!overrides.size) return context;
  return { ...context, overrides, key: [...overrides].map(([variant, code]) => `${variant}\u0000${code}`).join('\u0001') };
}

/** Nom réel → code, sur tout ce qui part vers l'API. */
function anonymize(text, dictionary, context = null) {
  if (dictionary.empty) return text;
  const overrides = context?.overrides || null;
  if (typeof text !== 'string' || text.length < MEMO_MIN_LENGTH) return applyMapping(text, dictionary.mapping, overrides);
  const memo = memoFor(dictionary);
  const key = overrides ? `${context.key}\u0002${text}` : text;
  const cached = memo.entries.get(key);
  if (cached !== undefined) {
    memo.entries.delete(key);
    memo.entries.set(key, cached);
    return cached;
  }
  const result = applyMapping(text, dictionary.mapping, overrides);
  memo.entries.set(key, result);
  memo.size += text.length + (result === text ? 0 : result.length);
  for (const [key, value] of memo.entries) {
    if (memo.size <= MEMO_BUDGET) break;
    memo.entries.delete(key);
    memo.size -= key.length + (value === key ? 0 : value.length);
  }
  return result;
}

function reverseFor(dictionary, projectId) {
  const retired = projectId ? dictionary.retiredByProject?.[projectId] : null;
  if (!retired) return dictionary.reverse;
  let byProject = projectReverses.get(dictionary);
  if (!byProject) {
    byProject = new Map();
    projectReverses.set(dictionary, byProject);
  }
  let reverse = byProject.get(projectId);
  if (!reverse) {
    const overrides = Object.entries(retired).filter(([, survivor]) => dictionary.reverse[survivor]).map(([code, survivor]) => [code, dictionary.reverse[survivor]]);
    reverse = overrides.length ? Object.freeze({ ...dictionary.reverse, ...Object.fromEntries(overrides) }) : dictionary.reverse;
    byProject.set(projectId, reverse);
  }
  return reverse;
}

/**
 * Code → nom réel, sur tout ce qui revient de l'API vers la machine. Dans une
 * session d'un dossier, un code que ce dossier a dû céder à un autre lors de la
 * renumérotation revient vers sa propre personne.
 */
function deanonymize(text, dictionary, context = null) {
  return dictionary.empty ? text : revertMapping(text, reverseFor(dictionary, context?.projectId));
}

module.exports = {
  EMPTY_DICTIONARY: EMPTY,
  anonymize,
  buildDictionary,
  deanonymize,
  resolveContext,
};
