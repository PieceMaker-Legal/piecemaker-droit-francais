/**
 * Réécriture des charges utiles qui traversent le proxy PII.
 *
 * Deux formes, deux difficultés très inégales :
 *
 *  - **JSON complet** (requêtes, réponses non streamées). Le corps est entier,
 *    on le parcourt et on substitue. Sans surprise.
 *
 *  - **SSE streamé** (`text/event-stream`, le cas normal d'une conversation).
 *    Le modèle émet un code en plusieurs fragments : « PERSONNE_ », « PHYSIQUE »,
 *    « _01 » arrivent dans trois événements `content_block_delta` distincts.
 *    Substituer fragment par fragment ne trouverait jamais rien. La solution est
 *    de retenir la fin de mot en cours tant qu'elle peut encore s'allonger, et
 *    de ne livrer que ce qui est définitivement terminé. Les consommateurs
 *    concatènent les deltas : découper autrement qu'à la source est sans effet,
 *    seule la concaténation finale compte.
 *
 * Le tampon de retenue est borné : au-delà, le fragment ne peut plus être un
 * code et il est livré tel quel plutôt que de retenir indéfiniment.
 */

/** Au-delà, une suite de caractères de mot n'est plus un code plausible. */
const MAX_HELD_WORD = 128;

/** Caractères qu'un code peut contenir — lettres, chiffres et underscore. */
const TRAILING_WORD = /[\p{L}\p{N}_]+$/u;

/**
 * Longueur de la fin de mot à retenir : livrer « PERSONNE_PHYSIQUE_01 » alors
 * que le fragment suivant apporte « _SA » produirait une dé-anonymisation
 * fausse au milieu d'un identifiant plus long.
 */
function heldLength(buffer) {
  const match = TRAILING_WORD.exec(buffer);
  if (!match) return 0;
  return match[0].length > MAX_HELD_WORD ? 0 : match[0].length;
}

/**
 * Réécrit récursivement toutes les chaînes d'une valeur JSON, clés comprises :
 * un nom réel peut aussi bien être une valeur de `tool_result` qu'une clé
 * produite par un listing de fichiers.
 */
function rewriteJsonValue(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map((item) => rewriteJsonValue(item, transform));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[transform(key)] = rewriteJsonValue(item, transform);
    }
    return output;
  }
  return value;
}

/**
 * Réécrit un corps JSON sérialisé. Si le corps n'est pas du JSON analysable, on
 * substitue sur le texte brut : moins précis, mais une charge utile non
 * analysée ne doit jamais sortir en clair.
 */
function rewriteJsonBody(raw, transform) {
  if (!raw) return raw;
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  try {
    return JSON.stringify(rewriteJsonValue(JSON.parse(text), transform));
  } catch {
    return transform(text);
  }
}

/** Les champs d'un événement SSE qui portent du texte produit par le modèle. */
/** Champs texte d'un `content_block_delta` Anthropic. */
const DELTA_TEXT_FIELDS = ['text', 'thinking', 'partial_json'];

/**
 * Transformateur d'un flux SSE.
 *
 * Trois formats de fil traversent ce proxy et tous découpent le texte en
 * fragments : Anthropic (`content_block_delta`), Responses d'OpenAI —
 * qu'utilise Codex — (`response.output_text.delta`) et Chat Completions —
 * qu'utilisent la plupart des fournisseurs compatibles OpenAI, dont opencode
 * (`choices[].delta.content`). Un seul mécanisme les couvre : une retenue de
 * fin de mot par bloc de texte concurrent, et une façon de resynthétiser un
 * delta au format d'origine pour vider cette retenue avant la fin du bloc.
 *
 * Chaque retenue mémorise donc son propre `synth` : le vidage sait reproduire
 * l'événement dans le format où il est arrivé, sans que le reste du code ait à
 * connaître les trois formes.
 */
function createSseRewriter(transform) {
  let pendingLines = '';
  const held = new Map();

  /** Retient la fin de mot en cours et rend ce qui est définitivement livrable. */
  function rewriteDelta(key, fragment, synth, synthType) {
    const entry = held.get(key);
    const buffer = (entry ? entry.tail : '') + fragment;
    const keep = heldLength(buffer);
    const emitted = keep ? buffer.slice(0, buffer.length - keep) : buffer;
    held.set(key, { tail: keep ? buffer.slice(buffer.length - keep) : '', synth, synthType });
    return emitted ? transform(emitted) : '';
  }

  /** Rend le delta de rattrapage d'un bloc terminé, ou null s'il n'y a rien à vider. */
  function flushKey(key) {
    const entry = held.get(key);
    held.delete(key);
    if (!entry || !entry.tail) return null;
    return { json: entry.synth(transform(entry.tail)), type: entry.synthType };
  }

  /** Rend les lignes d'un événement SSE. */
  function lines(json, eventName) {
    return eventName ? `event: ${eventName}\ndata: ${json}` : `data: ${json}`;
  }

  /**
   * Fait précéder un événement des deltas de rattrapage des blocs qu'il termine.
   *
   * Le nom d'événement est réémis avec chaque charge utile : le `event:` déjà
   * présent en amont dans le flux serait sinon attribué au premier delta injecté
   * — un client Anthropic verrait un delta étiqueté `content_block_stop`. Un
   * champ SSE répété étant écrasé par le dernier, réémettre est sans risque.
   */
  function withFlush(keys, eventJson, eventName) {
    const parts = [];
    for (const key of keys) {
      const extra = flushKey(key);
      if (extra) parts.push(lines(extra.json, extra.type));
    }
    if (!parts.length) return lines(eventJson, undefined);
    parts.push(lines(eventJson, eventName));
    return parts.join('\n\n');
  }

  function rewriteAnthropic(parsed) {
    const index = Number.isInteger(parsed.index) ? parsed.index : 0;
    const key = `a:${index}`;
    const synth = (text) => JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } });

    if (parsed.type === 'content_block_delta' && parsed.delta) {
      for (const field of DELTA_TEXT_FIELDS) {
        if (typeof parsed.delta[field] !== 'string') continue;
        parsed.delta[field] = rewriteDelta(key, parsed.delta[field], synth, 'content_block_delta');
      }
      return lines(JSON.stringify(parsed), undefined);
    }
    // Le reste retenu doit sortir AVANT la fin du bloc : on le raccroche à un
    // dernier delta, faute de quoi la fin du dernier mot serait perdue.
    return withFlush([key], JSON.stringify(parsed), parsed.type);
  }

  /**
   * API Responses : le texte arrive dans `delta` (une chaîne nue), identifié par
   * `item_id` — le même item peut porter plusieurs parts, d'où `content_index`.
   */
  function rewriteResponses(parsed) {
    const owner = parsed.item_id ?? parsed.output_index ?? 0;
    const part = parsed.content_index ?? 0;
    const key = `r:${owner}:${part}`;
    const synth = (delta) => JSON.stringify({ ...parsed, type: 'response.output_text.delta', delta });

    if (typeof parsed.delta === 'string') {
      parsed.delta = rewriteDelta(key, parsed.delta, synth, 'response.output_text.delta');
      return lines(JSON.stringify(parsed), undefined);
    }
    // `response.completed` clôt tout le flux, les autres `.done` un seul bloc.
    const keys = parsed.type === 'response.completed' ? [...held.keys()] : [key];
    return withFlush(keys, JSON.stringify(parsed), parsed.type);
  }

  /** Chat Completions : un delta par `choices[i]`, terminé par `finish_reason`. */
  function rewriteChatChunk(parsed) {
    const flushed = [];
    for (const choice of parsed.choices) {
      if (!choice || typeof choice !== 'object') continue;
      const index = Number.isInteger(choice.index) ? choice.index : 0;
      const key = `c:${index}`;
      const synth = (content) => JSON.stringify({
        ...parsed,
        choices: [{ index, delta: { content }, finish_reason: null }],
      });
      for (const field of ['content', 'reasoning_content', 'refusal']) {
        if (typeof choice.delta?.[field] !== 'string') continue;
        choice.delta[field] = rewriteDelta(key, choice.delta[field], synth, undefined);
      }
      if (choice.finish_reason) flushed.push(key);
    }
    return withFlush(flushed, JSON.stringify(parsed), undefined);
  }

  function rewriteEventPayload(payload) {
    // Sentinelle de fin des flux OpenAI : dernière occasion de vider les retenues.
    if (payload.trim() === '[DONE]') return withFlush([...held.keys()], payload, undefined);

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return transform(payload);
    }
    if (!parsed || typeof parsed !== 'object') return lines(JSON.stringify(rewriteJsonValue(parsed, transform)), undefined);

    if (typeof parsed.type === 'string' && parsed.type.startsWith('content_block')) return rewriteAnthropic(parsed);
    if (typeof parsed.type === 'string' && parsed.type.startsWith('response.')) return rewriteResponses(parsed);
    if (Array.isArray(parsed.choices)) return rewriteChatChunk(parsed);

    // Les événements restants (message_start, message_delta, error, en-têtes de
    // flux) ne portent pas de texte fragmenté, mais peuvent porter des libellés.
    return lines(JSON.stringify(rewriteJsonValue(parsed, transform)), undefined);
  }

  return {
    /** Consomme un morceau du flux, rend ce qui peut être livré maintenant. */
    push(chunk) {
      pendingLines += chunk;
      // Un événement SSE se termine par une ligne vide ; on ne traite que ce qui
      // est complet et on garde le reste pour le morceau suivant.
      const boundary = pendingLines.lastIndexOf('\n\n');
      if (boundary === -1) return '';
      const complete = pendingLines.slice(0, boundary + 2);
      pendingLines = pendingLines.slice(boundary + 2);

      return complete
        .split('\n')
        .map((line) => (line.startsWith('data: ') ? rewriteEventPayload(line.slice(6)) : line))
        .join('\n');
    },

    /** Fin de flux : livre les lignes incomplètes et toutes les retenues. */
    end() {
      let output = pendingLines;
      pendingLines = '';
      for (const key of [...held.keys()]) {
        const extra = flushKey(key);
        if (!extra) continue;
        output += `${lines(extra.json, extra.type)}\n\n`;
      }
      return output;
    },
  };
}

module.exports = {
  MAX_HELD_WORD,
  createSseRewriter,
  heldLength,
  rewriteJsonBody,
  rewriteJsonValue,
};
