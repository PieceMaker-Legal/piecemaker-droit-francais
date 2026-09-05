'use strict';

/**
 * Collecteur du texte visible d'un flux SSE, pour le harnais de citations
 * (`verification.cjs` vérifie le dernier message de l'assistant, jamais un
 * fragment isolé) — un bloc `<CITATIONS>` n'existe qu'une fois le message
 * entièrement reconstitué.
 *
 * Mêmes trois formats de fil que `rewrite.cjs` (`createSseRewriter`), lus à
 * l'identique plutôt que devinés : Anthropic (`content_block_delta`, champ
 * `delta.text`), Responses d'OpenAI (`response.output_text.delta`, champ
 * `delta`) et Chat Completions (`choices[].delta.content`). Volontairement
 * exclus : `delta.thinking` et `delta.partial_json` côté Anthropic (le
 * raisonnement et les arguments d'outil ne sont pas le texte de réponse), et
 * `reasoning_content`/`refusal` côté Chat Completions pour la même raison.
 *
 * Ce collecteur lit exactement ce qui est ÉCRIT AU CLIENT (donc après le
 * rewriter de `rewrite.cjs` quand il y en a un) : il ne refait aucune
 * substitution, il ne fait qu'observer un texte déjà en clair.
 *
 * Ne jette jamais : un événement illisible (JSON invalide, forme inattendue)
 * est simplement ignoré, jamais une exception qui remonterait au proxy.
 */

/**
 * Plafond de mémoire, en caractères accumulés. Un bloc `<CITATIONS>` se
 * trouve toujours en fin de réponse : au-delà de ce plafond, on cesse
 * d'accumuler plutôt que de laisser grossir la mémoire sans fin sur une
 * réponse anormalement longue — la vérification portera alors sur un texte
 * tronqué (donc un bloc `<CITATIONS>` absent, silence total côté harnais),
 * ce qui est le sens de la marche sûr plutôt qu'une fuite mémoire.
 */
const MAX_CARACTERES_COLLECTES = 2 * 1024 * 1024;

/** Texte visible porté par un événement déjà analysé en JSON, ou `''`. */
function texteVisible(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';

  if (parsed.type === 'content_block_delta' && typeof parsed.delta?.text === 'string') {
    return parsed.delta.text;
  }

  if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
    return parsed.delta;
  }

  if (Array.isArray(parsed.choices)) {
    let out = '';
    for (const choice of parsed.choices) {
      if (choice && typeof choice.delta?.content === 'string') out += choice.delta.content;
    }
    return out;
  }

  return '';
}

/**
 * @returns {{ push: (chunk: string) => void, texte: () => string }}
 */
function createCollecteurTexte() {
  let pending = '';
  let texte = '';
  let plein = false;

  function absorbeLigne(line) {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') return;

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return; // ligne SSE illisible : ignorée, jamais une exception.
    }

    const fragment = texteVisible(parsed);
    if (!fragment) return;
    texte += fragment;
    if (texte.length >= MAX_CARACTERES_COLLECTES) plein = true;
  }

  return {
    push(chunk) {
      if (plein) return;
      try {
        pending += typeof chunk === 'string' ? chunk : String(chunk);
        // On ne traite que les lignes complètes ; la dernière (peut-être
        // coupée par la frontière de ce fragment) attend le prochain appel.
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          if (plein) break;
          absorbeLigne(line);
        }
      } catch {
        // Un fragment illisible ne doit jamais interrompre la collecte.
      }
    },

    texte() {
      return texte;
    },
  };
}

module.exports = {
  MAX_CARACTERES_COLLECTES,
  createCollecteurTexte,
};
