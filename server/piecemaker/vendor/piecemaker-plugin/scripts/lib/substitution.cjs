/**
 * Moteur de substitution d'anonymisation — implémentation unique, sans
 * dépendance au dépôt (modules Node natifs uniquement).
 *
 * Extrait de `mapping.cjs`, qui le ré-exporte : une seule définition des
 * frontières de mots, des variantes Unicode et du tri longest-entity-first,
 * sinon deux moteurs de substitution divergent silencieusement.
 *
 * Ce moteur CommonJS est partagé par le proxy PII (`anonymizer/dictionary.cjs`),
 * l'historique et les autres surfaces locales.
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

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MIN_ENTITY_LENGTH = 4;
const MIN_UNBOUNDED_ENTITY_LENGTH = 5;

/**
 * Caractères de mot, Unicode : le \b de JS est ASCII et casse sur « Dupré ».
 * L'underscore n'en fait PAS partie : il délimite (« US_SA » → « US » est isolé),
 * car les noms de fichiers soudent les termes par « _ ». La protection des codes
 * contre une réécriture interne ne repose plus sur « _ » (il séparait les
 * segments d'un code) mais sur le masquage préalable des codes dans `applyMapping`.
 */
const WORD_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}])';
const WORD_BOUNDARY_AFTER = '(?![\\p{L}\\p{N}])';

/**
 * Ponctuations à plusieurs orthographes Unicode, ramenées à une classe qui les
 * accepte toutes. Pas hypothétique : le scanner normalise le texte des entités
 * en NFKC, qui réécrit U+2011 (trait d'union insécable) en U+2010. ALPHABIO
 * contient « Kreos‑A » en U+2011, le mapping portait donc « Kreos‐A » en U+2010
 * et la substitution ne trouvait rien — une entité détectée puis laissée en
 * clair dans le document livré.
 */
const CHAR_VARIANTS = [
  // trait d'union, tirets, signe moins
  { chars: '-‐‑‒–—―−', class: '[-\\u2010-\\u2015\\u2212]' },
  // apostrophes droites et typographiques — omniprésentes en français
  { chars: "'‘’ʼ´", class: "['\\u2018\\u2019\\u02BC\\u00B4]" },
  // guillemets doubles
  { chars: '"“”«»', class: '["\\u201C\\u201D]' },
];

const VARIANT_OF = new Map();
for (const { chars, class: cls } of CHAR_VARIANTS) {
  for (const c of chars) VARIANT_OF.set(c, cls);
}

/** Échappe un token en remplaçant chaque caractère à variantes par sa classe. */
function escapeWithVariants(token) {
  let out = '';
  for (const ch of token) {
    out += VARIANT_OF.get(ch) || escapeRegex(ch);
  }
  return out;
}

function buildEntityRegex(entity) {
  if (typeof entity !== 'string') return null;

  const trimmed = entity.trim();
  if (!trimmed || !/[\p{L}\p{N}]/u.test(trimmed)) return null;

  const pattern = trimmed
    .split(/\s+/)
    .map(escapeWithVariants)
    .join('\\s+');

  if (trimmed.length >= MIN_UNBOUNDED_ENTITY_LENGTH) {
    return new RegExp(pattern, 'giu');
  }

  if (trimmed.length === MIN_ENTITY_LENGTH) {
    return new RegExp(WORD_BOUNDARY_BEFORE + pattern + WORD_BOUNDARY_AFTER, 'giu');
  }

  if (trimmed.length <= 3) {
    const uppercasePattern = trimmed
      .toUpperCase()
      .split(/\s+/)
      .map(escapeWithVariants)
      .join('\\s+');
    return new RegExp(WORD_BOUNDARY_BEFORE + uppercasePattern + WORD_BOUNDARY_AFTER, 'gu');
  }
  return null;
}

/**
 * Ordonne les entrées d'un mapping de la plus longue entité à la plus courte.
 *
 * La substitution est séquentielle : une entité imbriquée ne doit jamais passer
 * avant celle qui la contient. Remplacer LOCATION « French » avant ORGANIZATION
 * « French Monetary and Financial Code » transforme la seconde en
 * « ADRESSE_07 Monetary and Financial Code ».
 */
function byDescendingEntityLength(getEntity) {
  return (a, b) => {
    const la = (getEntity(a) || '').length;
    const lb = (getEntity(b) || '').length;
    return lb - la;
  };
}

function mappingSignature(entries) {
  let signature = '';
  for (const [key, value] of entries) signature += key + '\u0000' + value + '\u0001';
  return signature;
}

function literalAnchor(value) {
  const runs = String(value).match(/[A-Za-z0-9_]+/g) || [];
  return runs.reduce((longest, run) => (run.length > longest.length ? run : longest), '');
}

const ANCHOR_WIDTH = 37;
const ANCHOR_SYMBOL = new Int8Array(128).fill(-1);
for (let letter = 0; letter < 26; letter += 1) {
  ANCHOR_SYMBOL[65 + letter] = letter;
  ANCHOR_SYMBOL[97 + letter] = letter;
}
for (let digit = 0; digit < 10; digit += 1) ANCHOR_SYMBOL[48 + digit] = 26 + digit;
ANCHOR_SYMBOL[95] = 36;
const KELVIN_SIGN = 0x212A;
const LONG_S = 0x017F;

function anchorSymbol(unit) {
  if (unit < 128) return ANCHOR_SYMBOL[unit];
  if (unit === KELVIN_SIGN) return ANCHOR_SYMBOL[107];
  if (unit === LONG_S) return ANCHOR_SYMBOL[115];
  return -1;
}

function buildAnchorScanner(anchors) {
  let transitions = new Int32Array(ANCHOR_WIDTH * 16).fill(-1);
  const outputs = [[]];
  let size = 1;
  anchors.forEach((anchor, index) => {
    if (!anchor) return;
    let node = 0;
    for (let position = 0; position < anchor.length; position += 1) {
      const slot = node * ANCHOR_WIDTH + ANCHOR_SYMBOL[anchor.charCodeAt(position)];
      if (transitions[slot] === -1) {
        if ((size + 1) * ANCHOR_WIDTH > transitions.length) {
          const grown = new Int32Array(transitions.length * 2).fill(-1);
          grown.set(transitions);
          transitions = grown;
        }
        transitions[slot] = size;
        outputs.push([]);
        size += 1;
      }
      node = transitions[slot];
    }
    outputs[node].push(index);
  });

  const failure = new Int32Array(size);
  const queue = [];
  for (let symbol = 0; symbol < ANCHOR_WIDTH; symbol += 1) {
    const child = transitions[symbol];
    if (child === -1) transitions[symbol] = 0;
    else queue.push(child);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head];
    outputs[node] = outputs[node].concat(outputs[failure[node]]);
    for (let symbol = 0; symbol < ANCHOR_WIDTH; symbol += 1) {
      const slot = node * ANCHOR_WIDTH + symbol;
      const child = transitions[slot];
      if (child === -1) {
        transitions[slot] = transitions[failure[node] * ANCHOR_WIDTH + symbol];
      } else {
        failure[child] = transitions[failure[node] * ANCHOR_WIDTH + symbol];
        queue.push(child);
      }
    }
  }

  const next = new Int32Array(size * ANCHOR_WIDTH);
  for (let slot = 0; slot < next.length; slot += 1) next[slot] = transitions[slot] * ANCHOR_WIDTH;
  const emitted = new Array(size * ANCHOR_WIDTH).fill(null);
  for (let node = 0; node < size; node += 1) if (outputs[node].length) emitted[node * ANCHOR_WIDTH] = outputs[node];

  return (text) => {
    const found = new Set();
    let state = 0;
    for (let position = 0; position < text.length; position += 1) {
      const symbol = anchorSymbol(text.charCodeAt(position));
      if (symbol === -1) {
        state = 0;
        continue;
      }
      state = next[state + symbol];
      const matched = emitted[state];
      if (matched !== null) for (const index of matched) found.add(index);
    }
    return found;
  };
}

function compileReplacements(replacements) {
  return { replacements, scan: buildAnchorScanner(replacements.map(({ anchor }) => anchor.toLowerCase())) };
}

function isDeeplyFrozen(object) {
  return Object.isFrozen(object) && Object.values(object).every((value) => !Array.isArray(value) || Object.isFrozen(value));
}

const compiledMappings = new WeakMap();

function compileMapping(mapping) {
  const cached = compiledMappings.get(mapping);
  if (cached && cached.frozen) return cached;
  const entries = Object.entries(mapping);
  const signature = mappingSignature(entries);
  if (cached && cached.signature === signature) return cached;

  const codes = [...new Set(entries.map(([, code]) => String(code)).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const replacements = [];
  for (const [entity, code] of entries.sort(byDescendingEntityLength(([key]) => key))) {
    const regex = buildEntityRegex(entity);
    if (!regex) continue;
    const trimmed = entity.trim();
    replacements.push({ regex, code, anchor: literalAnchor(regex.flags.includes('i') ? trimmed : trimmed.toUpperCase()) });
  }
  const compiled = {
    frozen: Object.isFrozen(mapping),
    signature,
    codes,
    codeProbe: codes.length ? new RegExp(codes.map(escapeRegex).join('|')) : null,
    replacements: compileReplacements(replacements),
  };
  compiledMappings.set(mapping, compiled);
  return compiled;
}

function applyReplacements({ replacements, scan }, text) {
  let output = text;
  let present = null;
  replacements.forEach(({ regex, code, anchor }, index) => {
    if (anchor) {
      if (present === null) present = scan(output);
      if (!present.has(index)) return;
    }
    const next = output.replace(regex, code);
    if (next !== output) {
      output = next;
      present = null;
    }
  });
  return output;
}

/**
 * Entité → code. Les entrées passent de la plus longue à la plus courte pour
 * qu'un nom contenu dans un autre ne consomme jamais le plus long en premier
 * (« Dupont » dans « Jean Dupont-Martin »).
 */
function applyMapping(text, mapping) {
  if (typeof text !== 'string' || !text) return text;
  if (!mapping || typeof mapping !== 'object') return text;
  const compiled = compileMapping(mapping);
  if (!compiled.replacements.replacements.length) return text;

  const restore = [];
  let masked = text;
  if (compiled.codeProbe && compiled.codeProbe.test(text)) {
    compiled.codes.forEach((code, idx) => {
      if (!masked.includes(code)) return;
      const token = String.fromCodePoint(0xE000 + idx);
      restore.push([token, code]);
      masked = masked.split(code).join(token);
    });
  }

  let output = applyReplacements(compiled.replacements, masked);
  if (output === masked) return text;

  for (const [token, code] of restore) output = output.split(token).join(code);
  return output;
}

const compiledReverseMappings = new WeakMap();

function compileReverseMapping(reverseMapping) {
  const cached = compiledReverseMappings.get(reverseMapping);
  if (cached && cached.frozen) return cached;
  const entries = Object.entries(reverseMapping);
  const signature = mappingSignature(entries.map(([code, variants]) => [code, Array.isArray(variants) ? variants[0] : variants]));
  if (cached && cached.signature === signature) return cached;

  const replacements = [];
  for (const [code, variants] of entries.sort(byDescendingEntityLength(([key]) => key))) {
    const canonical = Array.isArray(variants) ? variants[0] : variants;
    if (!canonical) continue;
    const regex = new RegExp(`${WORD_BOUNDARY_BEFORE}${escapeRegex(String(code))}${WORD_BOUNDARY_AFTER}`, 'giu');
    replacements.push({ regex, code: String(canonical), anchor: literalAnchor(code) });
  }
  const compiled = { frozen: isDeeplyFrozen(reverseMapping), signature, replacements: compileReplacements(replacements) };
  compiledReverseMappings.set(reverseMapping, compiled);
  return compiled;
}

/**
 * Code → entité. Le premier variant du tableau fait foi : c'est l'orthographe
 * canonique retenue par `consolidate_duplicate_entities`, celle qu'un humain
 * doit lire.
 *
 * Les codes sont traités du plus long au plus court, sinon
 * `PERSONNE_PHYSIQUE_1` mangerait le préfixe de `PERSONNE_PHYSIQUE_12` et
 * laisserait un « Jean Dupont2 » derrière lui. La frontière de mot ne suffit
 * pas : `2` est un caractère de mot, donc `PERSONNE_PHYSIQUE_1` ne matche pas
 * `PERSONNE_PHYSIQUE_12` — mais le tri reste la garantie qui ne dépend pas de
 * la forme des codes.
 *
 * La casse du code est ignorée, comme celle de l'entité à l'aller : un modèle
 * qui écrit « personne_physique_01 » désigne la même personne, et le texte livré
 * à l'humain doit porter son nom, pas un code resté en clair.
 */
function revertMapping(text, reverseMapping) {
  if (typeof text !== 'string' || !text) return text;
  if (!reverseMapping || typeof reverseMapping !== 'object') return text;
  const compiled = compileReverseMapping(reverseMapping);
  return applyReplacements(compiled.replacements, text);
}

function normalizedPathName(value) {
  return String(value || '').normalize('NFC');
}

function pathExists(value) {
  try {
    return fs.existsSync(value);
  } catch {
    return false;
  }
}

/**
 * Résout un chemin codé vers le fichier réellement présent sur disque.
 *
 * Un code peut représenter plusieurs variantes d'une même entité. Le premier
 * élément du reverse mapping est canonique pour du texte produit, mais il ne
 * permet donc pas toujours de reconstruire un nom de fichier existant. La
 * résolution suit cet ordre, du plus déterministe au plus prudent :
 *
 *  1. le chemin littéral existe déjà (un fichier peut lui-même porter le code) ;
 *  2. le chemin obtenu par ré-identification canonique existe ;
 *  3. chaque segment manquant est recherché parmi les enfants du répertoire
 *     courant, et accepté seulement si UN SEUL nom s'anonymise vers le segment
 *     demandé.
 *
 * Si aucune correspondance unique n'existe, le chemin codé d'origine est
 * conservé. L'outil échouera alors avec un code, plutôt que de recevoir un nom
 * réel inventé ou le mauvais fichier.
 */
function resolveMappedPath(value, mapping, reverseMapping, cwd = process.cwd()) {
  if (typeof value !== 'string' || !value) return value;

  const base = typeof cwd === 'string' && cwd ? path.resolve(cwd) : process.cwd();
  const requestedAbsolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(base, value);
  if (pathExists(requestedAbsolute)) return value;

  const canonical = revertMapping(value, reverseMapping);
  const canonicalAbsolute = path.isAbsolute(canonical)
    ? path.resolve(canonical)
    : path.resolve(base, canonical);
  if (canonical !== value && pathExists(canonicalAbsolute)) return canonical;

  const parsed = path.parse(requestedAbsolute);
  const segments = requestedAbsolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = parsed.root;

  for (const segment of segments) {
    const literal = path.join(current, segment);
    if (pathExists(literal)) {
      current = literal;
      continue;
    }

    const canonicalSegment = revertMapping(segment, reverseMapping);
    const canonicalCandidate = path.join(current, canonicalSegment);
    if (canonicalSegment !== segment && pathExists(canonicalCandidate)) {
      current = canonicalCandidate;
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return value;
    }

    const expected = normalizedPathName(segment);
    const matches = entries.filter((entry) => (
      normalizedPathName(applyMapping(entry.name, mapping)) === expected
    ));
    if (matches.length !== 1) return value;
    current = path.join(current, matches[0].name);
  }

  return path.isAbsolute(value) ? current : (path.relative(base, current) || '.');
}

module.exports = {
  applyMapping,
  buildEntityRegex,
  byDescendingEntityLength,
  escapeRegex,
  escapeWithVariants,
  resolveMappedPath,
  revertMapping,
  MIN_ENTITY_LENGTH,
  WORD_BOUNDARY_BEFORE,
  WORD_BOUNDARY_AFTER,
};
