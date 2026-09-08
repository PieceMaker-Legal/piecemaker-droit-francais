/**
 * Amorçage du surlignage des identités protégées.
 *
 * Volontairement passif : une seule ligne d'import dans `src/main.tsx` suffit,
 * et tout échec (session non authentifiée, backend absent, navigateur sans
 * l'API Highlight) se solde par une interface strictement identique à
 * l'originale.
 */

import { fetchIdentityDictionary } from '@/piecemaker/anonymizer/names';
import { createIdentityHighlighter } from '@/piecemaker/anonymizer/highlighter';

/** Le mapping ne bouge qu'à la conversion d'un dossier : un sondage lent suffit. */
const POLL_INTERVAL_MS = 60_000;
/** Avant authentification, la route répond 401 : on réessaie plus vite. */
const RETRY_INTERVAL_MS = 10_000;

let started = false;

export function startIdentityHighlighting(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;

  const highlighter = createIdentityHighlighter();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let version = -1;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    const dictionary = await fetchIdentityDictionary();
    if (stopped) return;
    if (dictionary.version !== version) {
      version = dictionary.version;
      highlighter.setNames(dictionary.names, dictionary.acronyms);
    }
    const known = dictionary.names.length + dictionary.acronyms.length;
    timer = setTimeout(() => void tick(), known ? POLL_INTERVAL_MS : RETRY_INTERVAL_MS);
  };

  void tick();

  return () => {
    stopped = true;
    started = false;
    if (timer) clearTimeout(timer);
    highlighter.stop();
  };
}

export { createIdentityHighlighter } from '@/piecemaker/anonymizer/highlighter';
export { fetchIdentityDictionary } from '@/piecemaker/anonymizer/names';
