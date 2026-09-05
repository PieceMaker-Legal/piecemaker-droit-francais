/**
 * Liste des identités protégées, telle que la sert `/api/piecemaker/anonymizer/dictionary`.
 *
 * Ces noms sont déjà affichés à l'écran : le proxy PII dé-anonymise les réponses
 * avant qu'elles n'atteignent l'interface. Les récupérer ici n'expose donc rien
 * de plus que le chat lui-même — cela permet seulement de savoir *quoi*
 * surligner.
 */

import { pmGet } from '@/piecemaker/dossier/api';

export type IdentityDictionary = {
  version: number;
  updatedAt: string | null;
  names: string[];
};

const EMPTY: IdentityDictionary = { version: 0, updatedAt: null, names: [] };

export async function fetchIdentityDictionary(signal?: AbortSignal): Promise<IdentityDictionary> {
  try {
    const payload = await pmGet<IdentityDictionary>('/anonymizer/dictionary', undefined, signal);
    if (!payload || !Array.isArray(payload.names)) return EMPTY;
    // Le plus long d'abord : « Jean Dupont » doit gagner sur « Dupont ».
    const names = payload.names
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 1)
      .sort((a, b) => b.length - a.length);
    return { version: payload.version ?? 0, updatedAt: payload.updatedAt ?? null, names };
  } catch {
    // Session non authentifiée, backend absent, dossier sans mapping : le
    // surlignage est un confort, jamais une condition de fonctionnement.
    return EMPTY;
  }
}

export { EMPTY as EMPTY_IDENTITY_DICTIONARY };
