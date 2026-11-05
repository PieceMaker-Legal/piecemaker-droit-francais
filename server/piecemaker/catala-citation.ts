import type { ReasoningConnectors } from '@/modules/piecemaker-reasoning/index.js';

import type { createCitationStore } from './harness/citation-store.js';
import { locateSourcePassages } from './harness/source-passages.js';

export function createCatalaCitation(connectors: Pick<ReasoningConnectors, 'source' | 'match'>, store: ReturnType<typeof createCitationStore>) {
  return async (cwd: string, id: string, quote: string, content: string) => {
    if (!/^(?:LEGIARTI|JURITEXT|CETATEXT)\d{12}$/.test(id) || !content.includes(id)) throw new Error('Source absente du programme Catala.');
    if (quote && !content.includes(quote) && !content.replace(/^>\s?/gm, '').includes(quote)) throw new Error('Citation absente du programme Catala.');
    const info = await connectors.source(cwd, id);
    if (!info) throw new Error('Texte officiel indisponible.');
    const verified = Boolean(quote && connectors.match(info.text, quote));
    const quotes = quote ? [{ quote, verification: { verified } }] : [];
    const source = info.validity ? `Validité : ${info.validity.from} → ${info.validity.to ?? 'en vigueur'}\n\n${info.text}` : info.text;
    return store.save({ sessionId: `catala:${cwd}`, title: info.title, source, citation: { ref: 1, ...(info.kind === 'decision' ? { kind: 'case', decision_id: id } : { kind: 'article', article_id: id }), verified, quotes }, ranges: locateSourcePassages(source, quotes) });
  };
}
